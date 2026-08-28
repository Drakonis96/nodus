import AdmZip from 'adm-zip';
import type {
  DatabaseDeepResearchExportOptions,
  DatabaseResearchReport,
} from '@shared/databaseDeepResearch';
import {
  redactDatabaseResearchMarkdown,
  sanitizeDatabaseResearchExternal,
} from '@shared/databaseDeepResearch';
import { anchoredMarkdown, PROFESSIONAL_REPORT_THEMES } from '@shared/professionalReport';
import * as repo from '../db/databaseDeepResearchRepo';
import {
  captureDatabaseResearchSnapshot,
  relationEdgesForRows,
  rehashDatabaseResearchSnapshot,
  sha256Snapshot,
} from '../ai/databaseDeepResearch';
import { getColumns, listViews } from '../db/databasesRepo';
import { professionalReportPdf } from './professionalReportPdf';

export interface DatabaseDeepResearchExport {
  bytes: Buffer;
  extension: 'md' | 'pdf' | 'zip';
  mime: string;
}

function requireDetail(reportId: string) {
  const report = repo.getDatabaseResearchReport(reportId);
  if (!report) throw new Error('Informe de Deep Research no encontrado.');
  const detail = repo.getDatabaseResearchRunDetail(report.runId);
  if (!detail) throw new Error('No se encuentra la ejecución que produjo el informe.');
  return { report, detail };
}

function stableJson(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    if (seen.has(item)) throw new Error('No se puede exportar una estructura cíclica.');
    seen.add(item);
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  }, 2);
}

function addStableFile(zip: AdmZip, path: string, data: string | Buffer): void {
  zip.addFile(path, Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'));
  const entry = zip.getEntry(path);
  if (entry) entry.header.time = new Date('1980-01-01T00:00:00.000Z');
}

function qualityMetrics(report: DatabaseResearchReport): Array<{ value: string; label: string }> {
  const quality = report.quality ?? {};
  const candidates: Array<[string, unknown]> = [
    ['Claims verificados', quality.verifiedClaims],
    ['Artefactos', quality.artifactCount],
    ['Cobertura', quality.coverage],
  ];
  return candidates
    .filter(([, value]) => typeof value === 'number' || typeof value === 'string')
    .map(([label, value]) => ({ label, value: String(value) }));
}

async function pdfFor(report: DatabaseResearchReport): Promise<Buffer> {
  const rendered = anchoredMarkdown(redactDatabaseResearchMarkdown(report.markdown), 'database-research');
  return professionalReportPdf({
    title: report.title,
    subtitle: 'Deep Research verificable de Bases de datos',
    kindLabel: 'Database Deep Research',
    language: String(report.metadata.language ?? 'es'),
    generatedLabel: 'Generado por Nodus',
    generatedAt: report.createdAt,
    objectiveLabel: 'Objetivo',
    objective: report.summary ?? undefined,
    metrics: qualityMetrics(report),
    contentsLabel: 'Contenido y trazabilidad',
    sections: [{
      id: 'database-research-report',
      number: '01',
      title: 'Informe verificable',
      eyebrow: 'Evidencia local · cálculos deterministas',
      html: rendered.html,
      tocChildren: rendered.headings,
    }],
    theme: PROFESSIONAL_REPORT_THEMES.deepResearch,
  });
}

export async function buildDatabaseDeepResearchExport(
  reportId: string,
  options: DatabaseDeepResearchExportOptions,
): Promise<DatabaseDeepResearchExport> {
  const { report, detail } = requireDetail(reportId);
  if (options.format === 'markdown') {
    return { bytes: Buffer.from(redactDatabaseResearchMarkdown(report.markdown), 'utf8'), extension: 'md', mime: 'text/markdown' };
  }
  if (options.format === 'pdf') {
    return { bytes: await pdfFor(report), extension: 'pdf', mime: 'application/pdf' };
  }

  const zip = new AdmZip();
  const manifest: Record<string, unknown> = {
    format: 'nodus-database-deep-research-v1',
    reportId: report.id,
    runId: detail.run.id,
    reportType: report.reportType ?? detail.run.reportType ?? report.metadata.reportType ?? 'general',
    language: report.metadata.language ?? detail.run.language ?? 'en',
    promptVersion: report.provenance.promptVersion ?? detail.run.options.promptVersion ?? null,
    createdAt: report.createdAt,
    model: detail.run.model,
    snapshotFingerprint: detail.run.snapshotFingerprint,
    includeSnapshot: options.includeSnapshot === true,
    files: [
      'report.md', 'report.json', 'run.json', 'steps.json', 'claims.json',
      'artifacts.json', 'charts.json',
    ],
  };
  const safeMarkdown = redactDatabaseResearchMarkdown(report.markdown);
  const safeStructured = sanitizeDatabaseResearchExternal(report.structured) as Record<string, unknown>;
  const safeReport = {
    ...report,
    title: redactDatabaseResearchMarkdown(report.title),
    summary: report.summary == null ? null : redactDatabaseResearchMarkdown(report.summary),
    markdown: safeMarkdown,
    bibliography: sanitizeDatabaseResearchExternal(report.bibliography),
    metadata: sanitizeDatabaseResearchExternal(report.metadata),
    structured: safeStructured,
    quality: sanitizeDatabaseResearchExternal(report.quality),
    provenance: sanitizeDatabaseResearchExternal(report.provenance),
  };
  // Steps and claims are separately persisted and may contain model echoes or
  // cell-derived labels even when the structured report was clean. Sanitize the
  // entire object graph before writing each file; only the opt-in snapshot below
  // can contain raw cell values.
  const safeRun = sanitizeDatabaseResearchExternal({
    ...detail.run,
    title: detail.run.title == null ? null : redactDatabaseResearchMarkdown(detail.run.title),
    objective: '[redacted]',
  });
  const safeSteps = sanitizeDatabaseResearchExternal(detail.steps);
  const safeClaims = sanitizeDatabaseResearchExternal(detail.claims);
  const safeCharts = sanitizeDatabaseResearchExternal(report.structured.charts ?? []);
  addStableFile(zip, 'report.md', safeMarkdown);
  addStableFile(zip, 'report.json', stableJson(safeReport));
  addStableFile(zip, 'run.json', stableJson(safeRun));
  addStableFile(zip, 'steps.json', stableJson(safeSteps));
  addStableFile(zip, 'claims.json', stableJson(safeClaims));
  addStableFile(zip, 'artifacts.json', stableJson(safeStructured.evidenceLedger ?? safeStructured.evidence ?? []));
  addStableFile(zip, 'charts.json', stableJson(safeCharts));

  if (options.includeSnapshot) {
    const configuredIds = Array.isArray(detail.run.options.databaseIds)
      ? detail.run.options.databaseIds.map(String)
      : [detail.run.databaseId];
    const viewIds = new Set(Array.isArray(detail.run.options.viewIds) ? detail.run.options.viewIds.map(String) : []);
    const filters = detail.run.options.filters && typeof detail.run.options.filters === 'object'
      ? detail.run.options.filters as { query?: unknown; columnIds?: unknown }
      : {};
    const maxRows = Math.max(1, Math.min(500_000, Number(detail.run.budget.maxRows ?? 500_000) || 500_000));
    const snapshots = configuredIds.map((databaseId) => {
      const selectedView = listViews(databaseId).find((view) => viewIds.has(view.id));
      const known = new Set(getColumns(databaseId).map((column) => column.id));
      const columnIds = Array.isArray(filters.columnIds) ? filters.columnIds.map(String).filter((id) => known.has(id)) : [];
      return captureDatabaseResearchSnapshot(databaseId, { maxRows }, undefined, { viewId: selectedView?.id ?? null, query: String(filters.query ?? ''), columnIds });
    });
    if (snapshots.length > 1) {
      const allowedTargets = new Set(snapshots.flatMap((snapshot) => snapshot.rows.map((row) => row.id)));
      for (const snapshot of snapshots) {
        snapshot.relationEdges = relationEdgesForRows(snapshot.databaseId, snapshot.rows, undefined, allowedTargets);
        snapshot.hash = rehashDatabaseResearchSnapshot(snapshot);
      }
    }
    const reportFingerprint = String(report.provenance.snapshotFingerprint ?? detail.run.snapshotFingerprint ?? '');
    if (!reportFingerprint) {
      throw new Error('El informe no conserva una huella de snapshot verificable; regenera la investigación antes de exportar datos brutos.');
    }
    const currentFingerprint = snapshots.length === 1
      ? snapshots[0].hash
      : sha256Snapshot(snapshots.map((snapshot) => ({ databaseId: snapshot.databaseId, hash: snapshot.hash })));
    if (reportFingerprint !== currentFingerprint) {
      throw new Error('Los datos han cambiado desde el informe. Regenera la investigación antes de exportar el snapshot bruto.');
    }
    const raw = snapshots.map(({ capturedAt: _capturedAt, ...snapshot }) => snapshot);
    addStableFile(zip, 'snapshot/data.json', stableJson(raw));
    (manifest.files as string[]).push('snapshot/data.json');
    manifest.snapshotDataHash = sha256Snapshot(raw);
  }
  // The manifest is an external boundary too. Sanitize every value first;
  // restore only the fixed archive member names generated by this function so
  // reproducibility is retained without allowing a user-controlled filename
  // or cell-derived label to escape.
  const safeManifest = sanitizeDatabaseResearchExternal(manifest) as Record<string, unknown>;
  safeManifest.files = [...(manifest.files as string[])];
  addStableFile(zip, 'manifest.json', stableJson(safeManifest));
  return { bytes: zip.toBuffer(), extension: 'zip', mime: 'application/zip' };
}
