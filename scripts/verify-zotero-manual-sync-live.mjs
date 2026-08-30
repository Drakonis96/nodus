// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Run the production legacy Zotero sync against the live, read-only local Zotero API
 * and a temporary SQLite backup. The user's source vault and Zotero profile are never
 * opened for writing. Pass --source-db /path/to/snapshot.sqlite to reproduce a historical
 * click; otherwise the active Nodus vault is used.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!process.argv.includes('--electron-zotero-manual-sync-live')) {
  process.env.NODUS_ZOTERO_MANUAL_SYNC_ARGS = JSON.stringify(process.argv.slice(2));
}
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-zotero-manual-sync-live')) process.exit(0);

const args = (() => {
  try { return JSON.parse(process.env.NODUS_ZOTERO_MANUAL_SYNC_ARGS ?? '[]'); } catch { return []; }
})();
const sourceArg = args.indexOf('--source-db');
const requestedSource = sourceArg >= 0 ? args[sourceArg + 1] : null;
if (sourceArg >= 0 && !requestedSource) throw new Error('--source-db requires a path');

const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-zotero-manual-sync-live-'));
const userData = path.join(scratch, 'user-data');
const targetDb = path.join(userData, 'vault.sqlite');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

function analysisRows(db) {
  return db.prepare(`SELECT nodus_id, light_status, light_at, light_hash,
    deep_status, deep_at, deep_hash, deep_error, deep_queued,
    summary_status, summary_at, summary_hash
    FROM works ORDER BY nodus_id`).all();
}

function derivedCounts(db) {
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return {
    ideas: count('ideas'),
    occurrences: count('idea_occurrences'),
    evidence: count('evidence'),
    passages: count('passages'),
  };
}

let closeDb = () => {};
try {
  const defaultUserData = path.join(os.homedir(), 'Library', 'Application Support', 'Nodus');
  const registry = JSON.parse(await readFile(path.join(defaultUserData, 'vaults.json'), 'utf8'));
  const active = registry.vaults.find((vault) => vault.id === registry.activeVaultId);
  const sourceDbValue = requestedSource ?? active?.path;
  assert.ok(sourceDbValue, 'No active Nodus vault was found');
  const sourceDbPath = path.resolve(sourceDbValue);

  await mkdir(userData, { recursive: true });
  const Database = require('better-sqlite3');
  const source = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
  try { await source.backup(targetDb); } finally { source.close(); }

  await writeFile(path.join(userData, 'vaults.json'), JSON.stringify({
    formatVersion: 1,
    activeVaultId: 'verification',
    vaults: [{
      id: 'verification', name: 'Read-only verification copy', path: targetDb,
      createdAt: new Date(0).toISOString(), lastOpenedAt: new Date(0).toISOString(),
      legacy: false, type: 'academic', origin: 'local',
    }],
  }, null, 2));

  const database = require('../electron/db/database.ts');
  closeDb = database.closeDb;
  const db = database.getDb();
  const beforeWorks = db.prepare('SELECT COUNT(*) AS n FROM works').get().n;
  const beforeAnalysis = analysisRows(db);
  const beforeDerived = derivedCounts(db);

  const { scanQueue } = require('../electron/pipeline/scanQueue.ts');
  const { documentIndexQueue } = require('../electron/pipeline/documentIndexQueue.ts');
  let analysisEnqueues = 0;
  let documentaryRefreshes = 0;
  scanQueue.enqueue = () => { analysisEnqueues += 1; throw new Error('manual refresh attempted to enqueue analysis'); };
  documentIndexQueue.refreshVault = () => { documentaryRefreshes += 1; throw new Error('manual refresh attempted documentary indexing'); };

  const zotero = require('../electron/zotero/zoteroClient.ts');
  const ping = await zotero.ping();
  assert.equal(ping.ok, true, `Zotero local API is unavailable: ${ping.message ?? ping.reason}`);
  const { fullSync } = require('../electron/sync/syncService.ts');
  const result = await fullSync('manual', { catalogOnly: true });

  const afterWorks = db.prepare('SELECT COUNT(*) AS n FROM works').get().n;
  const afterAnalysisById = new Map(analysisRows(db).map((row) => [row.nodus_id, row]));
  const afterDerived = derivedCounts(db);
  for (const before of beforeAnalysis) {
    assert.deepEqual(afterAnalysisById.get(before.nodus_id), before, `manual refresh changed analysis state for ${before.nodus_id}`);
  }
  assert.deepEqual(afterDerived, beforeDerived, 'manual refresh changed derived ideas, evidence or passages');
  assert.equal(analysisEnqueues, 0, 'manual refresh enqueued AI analysis');
  assert.equal(documentaryRefreshes, 0, 'manual refresh started documentary indexing');
  assert.match(result.summary, /catálogo actualizado sin iniciar análisis/);

  const newStatuses = db.prepare(`SELECT light_status, deep_status, summary_status, deep_queued, COUNT(*) AS n
    FROM works WHERE nodus_id NOT IN (${beforeAnalysis.map(() => '?').join(',') || "''"})
    GROUP BY light_status, deep_status, summary_status, deep_queued`).all(...beforeAnalysis.map((row) => row.nodus_id));
  for (const row of newStatuses) {
    assert.equal(row.light_status, 'none');
    assert.equal(row.deep_status, 'none');
    assert.equal(row.summary_status, 'none');
    assert.equal(row.deep_queued, 0);
  }

  console.log(JSON.stringify({
    sourceDb: path.basename(sourceDbPath),
    zoteroVersion: ping.version,
    beforeWorks,
    afterWorks,
    newWorks: afterWorks - beforeWorks,
    derivedCounts: afterDerived,
    analysisEnqueues,
    documentaryRefreshes,
    summary: result.summary,
  }, null, 2));
  console.log('STRICT PASS: live Zotero catalog refresh changed only the isolated catalog copy.');
} finally {
  try { closeDb(); } catch { /* already closed */ }
  await rm(scratch, { recursive: true, force: true });
}
