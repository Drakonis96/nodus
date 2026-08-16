import type Database from 'better-sqlite3';

const PREFIX = 'nodus_backup_revision_';

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Install durable, transactional dirty tracking for backup reuse.
 *
 * Unlike mtime, this token cannot miss a write hidden in WAL and it survives app
 * restarts. Triggers live in the vault itself, so writes from any SQLite connection
 * increment the same counter. Virtual tables are excluded (SQLite forbids triggers on
 * them); their source/content tables are tracked normally.
 */
export function ensureBackupRevisionTriggers(db: Database.Database): void {
  const tables = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name <> 'backup_revision'
      AND COALESCE(sql, '') NOT LIKE 'CREATE VIRTUAL TABLE%'
    ORDER BY name
  `).all() as Array<{ name: string }>;
  const desired = new Set<string>();
  for (const { name } of tables) {
    for (const operation of ['insert', 'update', 'delete'] as const) {
      const triggerName = `${PREFIX}${operation}_${name}`;
      desired.add(triggerName);
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS ${quoteIdentifier(triggerName)}
        AFTER ${operation.toUpperCase()} ON ${quoteIdentifier(name)}
        BEGIN
          UPDATE backup_revision SET sequence = sequence + 1 WHERE singleton = 1;
        END
      `);
    }
  }
  const existing = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE ?"
  ).all(`${PREFIX}%`) as Array<{ name: string }>;
  for (const { name } of existing) {
    if (!desired.has(name)) db.exec(`DROP TRIGGER ${quoteIdentifier(name)}`);
  }
}

/** Stable identity for a reusable database entry; schema changes invalidate it too. */
export function backupVaultRevision(db: Database.Database): string {
  const row = db.prepare('SELECT sequence FROM backup_revision WHERE singleton = 1').get() as { sequence: number } | undefined;
  const schema = db.pragma('user_version', { simple: true }) as number;
  return `${schema}:${row?.sequence ?? 0}`;
}
