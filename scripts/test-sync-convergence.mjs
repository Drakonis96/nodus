import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, repoRoot, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const scriptPath = fileURLToPath(import.meta.url);
if (!requireElectronRuntime(scriptPath, '--electron-sync-convergence-test')) process.exit(0);
const externalQaProfile = Boolean(process.env.NODUS_USERDATA);
const root = externalQaProfile
  ? path.join(path.resolve(process.env.NODUS_USERDATA), 'sync-convergence-test')
  : await mkdtemp(path.join(os.tmpdir(), 'nodus-sync-convergence-'));
if (externalQaProfile) await mkdir(root, { recursive: true });
installRuntimeHooks(root); const require = createRequire(import.meta.url);

try {
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const { applyIncomingMutations } = require(path.join(repoRoot, 'electron/serverSync/mutationInbox.ts'));
  const db = getDb(); assert.ok(SCHEMA_VERSION >= 150);
  const timestamp = '2026-08-17T00:00:00.000Z';
  db.prepare(`INSERT INTO notes (id, folder_id, title, kind, content, source_json, order_idx, created_at, updated_at)
    VALUES ('hlc-note', NULL, 'Convergencia', 'markdown', 'origen', NULL, 0, ?, ?)`).run(timestamp, timestamp);
  const row = (content, updatedAt) => ({ id: 'hlc-note', folder_id: null, title: 'Convergencia', kind: 'markdown', content,
    source_json: null, order_idx: 0, created_at: timestamp, updated_at: updatedAt });
  const operation = (id, seq, deviceId, hlc, content) => ({ id, seq, clientId: deviceId, actorId: deviceId,
    deviceId, hlc, kind: 'upsert', table: 'notes', key: ['hlc-note'], row: row(content, timestamp),
    schemaVersion: SCHEMA_VERSION, createdAt: timestamp });

  const first = operation('op-a', 1, 'device-a', '1786924800000-000001-device-a', 'A');
  const second = operation('op-b', 2, 'device-b', '1786924800000-000001-device-b', 'B');
  assert.equal(applyIncomingMutations(db, [first]).applied, 1);
  assert.equal(applyIncomingMutations(db, [second]).applied, 1, 'stable device tie-break applies the same winner everywhere');
  assert.equal(db.prepare("SELECT content FROM notes WHERE id = 'hlc-note'").get().content, 'B');
  assert.equal(applyIncomingMutations(db, [first]).keptLocal, 1, 'late replay cannot replace the HLC winner');
  const clock = db.prepare("SELECT * FROM sync_row_clocks WHERE table_name = 'notes' AND row_key = '[\"hlc-note\"]'").get();
  assert.equal(clock.hlc, second.hlc); assert.equal(clock.operation_id, second.id);
  const conflicts = db.prepare("SELECT * FROM sync_conflicts WHERE table_name = 'notes'").all();
  assert.equal(conflicts.length, 1, 'replaying the same conflict is idempotent');
  assert.ok(conflicts.every((entry) => entry.winning_operation_id === 'op-b'));

  const staleDelete = { ...first, id: 'op-delete-a', seq: 3, kind: 'delete', row: null };
  assert.equal(applyIncomingMutations(db, [staleDelete]).keptLocal, 1);
  assert.ok(db.prepare("SELECT 1 FROM notes WHERE id = 'hlc-note'").get());
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sync_conflicts WHERE table_name = 'notes'").get().count, 2);
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok'); assert.deepEqual(db.pragma('foreign_key_check'), []);
  closeDb(); console.log('HLC convergence and conflict log test passed!');
} finally { if (!externalQaProfile) await rm(root, { recursive: true, force: true }); }
