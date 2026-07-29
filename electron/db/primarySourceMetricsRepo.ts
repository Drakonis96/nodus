import { randomUUID } from 'node:crypto';
import type {
  PrimarySourceLocalMetricName,
  PrimarySourceLocalMetricSummary,
} from '@shared/primarySourcesTypes';
import { getActiveVault } from '../vaults/vaultRegistry';
import { getDb } from './database';
import { getSettings } from './settingsRepo';

const ALLOWED_EVENTS = new Set<PrimarySourceLocalMetricName>([
  'archive_list',
  'archive_filter',
  'dossier_open',
  'research_search',
  'demo_seed',
  'package_export',
  'package_restore',
]);

function countBucket(count: number): string {
  const value = Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0));
  if (value === 0) return '0';
  if (value <= 10) return '1-10';
  if (value <= 100) return '11-100';
  if (value <= 1_000) return '101-1000';
  if (value <= 10_000) return '1001-10000';
  if (value <= 100_000) return '10001-100000';
  return '100000+';
}

/**
 * Record one coarse performance point only after explicit opt-in. The schema makes
 * accidental content capture structurally impossible: there is no free-text payload
 * column and event names are allow-listed here and in SQLite.
 */
export function recordPrimarySourceLocalMetric(
  eventName: PrimarySourceLocalMetricName,
  durationMs: number,
  itemCount: number,
  success = true,
): void {
  if (
    getActiveVault().type !== 'primary_sources'
    || !getSettings().primarySourcesLocalMetricsEnabled
    || !ALLOWED_EVENTS.has(eventName)
  ) return;
  const db = getDb();
  db.prepare(
    `INSERT INTO primary_source_local_metrics (
      metric_id, event_name, duration_ms, item_count_bucket, success, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    `psm_${randomUUID()}`,
    eventName,
    Math.max(0, Math.round((Number.isFinite(durationMs) ? durationMs : 0) * 10) / 10),
    countBucket(itemCount),
    Number(success),
    new Date().toISOString(),
  );
  // A bounded local history is sufficient for beta diagnostics and prevents an
  // unattended vault from accumulating telemetry forever.
  db.prepare(
    `DELETE FROM primary_source_local_metrics
      WHERE metric_id IN (
        SELECT metric_id FROM primary_source_local_metrics
        ORDER BY created_at DESC, metric_id DESC LIMIT -1 OFFSET 2000
      )`
  ).run();
}

export function getPrimarySourceLocalMetricSummary(): PrimarySourceLocalMetricSummary {
  const db = getDb();
  const rows = db.prepare(
    `SELECT event_name, duration_ms, success, created_at
       FROM primary_source_local_metrics
      ORDER BY created_at, metric_id`
  ).all() as Array<{
    event_name: PrimarySourceLocalMetricName;
    duration_ms: number;
    success: number;
    created_at: string;
  }>;
  const byEvent = new Map<PrimarySourceLocalMetricName, typeof rows>();
  for (const row of rows) {
    const group = byEvent.get(row.event_name) ?? [];
    group.push(row);
    byEvent.set(row.event_name, group);
  }
  return {
    enabled: Boolean(getSettings().primarySourcesLocalMetricsEnabled),
    localOnly: true,
    contentFree: true,
    total: rows.length,
    oldestAt: rows[0]?.created_at ?? null,
    newestAt: rows.at(-1)?.created_at ?? null,
    events: [...byEvent].map(([eventName, values]) => {
      const sorted = values.map((value) => Number(value.duration_ms)).sort((a, b) => a - b);
      return {
        eventName,
        runs: values.length,
        failures: values.filter((value) => !value.success).length,
        averageDurationMs: Math.round(
          (sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length)) * 10
        ) / 10,
        p95DurationMs: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
      };
    }),
  };
}

export function clearPrimarySourceLocalMetrics(): void {
  getDb().prepare('DELETE FROM primary_source_local_metrics').run();
}
