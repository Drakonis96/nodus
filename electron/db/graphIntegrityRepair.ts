// App side of the graph-integrity audit and repair (electron/db/graphIntegrity.ts): the
// once-per-vault pass at startup and vault switch, and the on-demand check, repair and
// theme follow-up behind Settings › Data › Graph health and the Themes panel.
import type { GraphIntegrityReport, GraphIntegrityRepairResult } from '@shared/types';
import { nodiText } from '@shared/nodiNotifications';
import { addNotification } from '../notifications';
import { getDb } from './database';
import {
  auditGraphIntegrity,
  pendingThemeRepairWorkIds,
  repairGraphIntegrity,
  setPendingThemeRepairWorkIds,
  type GraphIntegrityRepair,
} from './graphIntegrity';

const REPAIR_FLAG = 'graph_integrity_repair_v1';

function logRepair(repair: GraphIntegrityRepair): void {
  const changed = Object.entries(repair.counts).filter(([, n]) => n > 0);
  if (changed.length > 0) {
    console.log(`[graph] integrity repair: ${changed.map(([key, n]) => `${key}=${n}`).join(', ')}`);
  }
  if (repair.integrityFailedWorks.length > 0) {
    console.log(
      `[graph] ${repair.integrityFailedWorks.length} work(s) last failed the deep-analysis integrity check; a retry reuses their checkpoints and no longer fails on links to dormant ideas: ${repair.integrityFailedWorks.map((work) => work.title ?? work.nodus_id).join('; ')}`
    );
  }
}

/**
 * Run the repair once per vault; later calls return null. It runs while the app starts
 * or switches vault, so a failure is logged and retried next time instead of stopping
 * either. When it removed idea theme links, Nodi says where to reassign those themes.
 */
export function repairGraphIntegrityOnce(): GraphIntegrityRepair | null {
  const db = getDb();
  const done = db.prepare('SELECT value FROM settings WHERE key = ?').get(REPAIR_FLAG) as { value: string } | undefined;
  if (done?.value === '1') return null;
  let repair: GraphIntegrityRepair;
  try {
    repair = db.transaction(() => {
      const result = repairGraphIntegrity(db);
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(REPAIR_FLAG, '1');
      return result;
    })();
  } catch (error) {
    console.error(`[graph] integrity repair failed, will retry on next start: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  logRepair(repair);
  if (repair.themeWorks.length > 0) {
    try {
      addNotification({
        title: nodiText('graphRepairedTitle'),
        body: nodiText('graphRepairedThemesBody', { works: repair.themeWorks.length }),
        kind: 'info',
        dedupeKey: 'graph-integrity-repair',
      });
    } catch {
      // A notification is a courtesy; the repair itself already committed.
    }
  }
  return repair;
}

export function checkGraphIntegrity(): GraphIntegrityReport {
  return auditGraphIntegrity(getDb());
}

/** On-demand repair. The caller takes the backup and checks that no scan is running. */
export function runGraphIntegrityRepair(): GraphIntegrityRepairResult {
  const db = getDb();
  const repair = repairGraphIntegrity(db);
  logRepair(repair);
  return { counts: repair.counts, integrityFailedWorks: repair.integrityFailedWorks, report: auditGraphIntegrity(db) };
}

export function pendingThemeWorkIds(): string[] {
  return pendingThemeRepairWorkIds(getDb());
}

export function dismissPendingThemeWorks(): void {
  setPendingThemeRepairWorkIds(getDb(), []);
}
