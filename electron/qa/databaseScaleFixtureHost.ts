import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';

import type { QaDatabaseScaleFixtureInput, QaDatabaseScaleFixtureStatus } from '@shared/databaseScaleQa';
import { getActiveVault } from '../vaults/vaultRegistry';
import * as dbMode from '../db/databasesRepo';

const jobs = new Map<string, QaDatabaseScaleFixtureStatus>();
const allowedScales = new Set([1_000, 10_000, 250_000, 500_000]);

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function authorizedVaultPath(): string {
  const qaRoot = process.env.NODUS_QA_ROOT;
  const userData = process.env.NODUS_USERDATA;
  if (!qaRoot || !userData) throw new Error('QA de escala deshabilitado fuera del runner aislado.');
  if (!isInside(qaRoot, userData)) throw new Error('QA abortado: NODUS_USERDATA está fuera del directorio autorizado.');
  const vault = getActiveVault();
  if (!isInside(qaRoot, vault.path) || !isInside(userData, vault.path)) {
    throw new Error('QA abortado: el vault activo está fuera del perfil efímero autorizado.');
  }
  return vault.path;
}

function workerFile(): string {
  return process.env.NODUS_QA_DATABASE_SCALE_WORKER_FILE
    || path.join(__dirname, 'databaseScaleFixtureWorker.cjs');
}

export function getQaDatabaseScaleFixtureStatus(jobId: string): QaDatabaseScaleFixtureStatus | null {
  // Re-check on every poll: changing environment/registry state while a runner is alive
  // must not turn this QA-only surface into a general bulk-write endpoint.
  authorizedVaultPath();
  return jobs.get(jobId) ?? null;
}

export function startQaDatabaseScaleFixture(
  input: QaDatabaseScaleFixtureInput,
  onProgress?: (status: QaDatabaseScaleFixtureStatus) => void,
): { jobId: string; databaseId: string } {
  const databasePath = authorizedVaultPath();
  if (!allowedScales.has(input?.rowCount)) throw new Error('Escala QA no permitida.');
  const batchSize = Math.max(100, Math.min(5_000, Math.trunc(input.batchSize ?? 1_000)));
  const database = dbMode.createDatabase(input.name?.trim() || `Escala QA ${input.rowCount.toLocaleString('es-ES')}`);
  const columns = {
    title: dbMode.createColumn(database.id, 'Nombre', 'title'),
    description: dbMode.createColumn(database.id, 'Descripción', 'rich_text'),
    amount: dbMode.createColumn(database.id, 'Cantidad', 'number', { numberFormat: 'currency', numberCurrency: 'EUR' }),
    progress: dbMode.createColumn(database.id, 'Progreso', 'number', { numberFormat: 'progress', progressMaximum: 100 }),
    status: dbMode.createColumn(database.id, 'Estado', 'status'),
    tags: dbMode.createColumn(database.id, 'Etiquetas', 'multi_select'),
    checked: dbMode.createColumn(database.id, 'Revisado', 'checkbox'),
    date: dbMode.createColumn(database.id, 'Fecha', 'date', { dateIncludeTime: true, dateTimeZone: 'Europe/Madrid' }),
    email: dbMode.createColumn(database.id, 'Email', 'email'),
    url: dbMode.createColumn(database.id, 'URL', 'url'),
    phone: dbMode.createColumn(database.id, 'Teléfono', 'phone'),
    location: dbMode.createColumn(database.id, 'Ubicación', 'location'),
    person: dbMode.createColumn(database.id, 'Responsable', 'person'),
    code: dbMode.createColumn(database.id, 'Código', 'text'),
    createdTime: dbMode.createColumn(database.id, 'Creado', 'created_time'),
    editedTime: dbMode.createColumn(database.id, 'Editado', 'last_edited_time'),
    uniqueId: dbMode.createColumn(database.id, 'ID', 'unique_id', { uniqueIdPrefix: 'QA', uniqueIdPadding: 7 }),
    relation: dbMode.createColumn(database.id, 'Anterior', 'relation', {
      relationTargetKind: 'db_row', relationTargetDatabaseId: database.id, relationCardinality: 'one',
    }),
    formula: null as ReturnType<typeof dbMode.createColumn> | null,
    rollup: null as ReturnType<typeof dbMode.createColumn> | null,
  };
  columns.formula = dbMode.createColumn(database.id, 'Total calculado', 'formula', {
    formula: { kind: 'arithmetic', op: 'add', operands: [
      { kind: 'column', columnId: columns.amount.id },
      { kind: 'column', columnId: columns.progress.id },
    ] },
    formulaDecimals: 2,
  });
  columns.rollup = dbMode.createColumn(database.id, 'Cantidad anterior', 'rollup', {
    rollupRelationColumnId: columns.relation.id,
    rollupTargetColumnId: columns.amount.id,
    rollupFunction: 'sum',
  });
  const statusOptions = [
    dbMode.addOption(columns.status.id, 'Pendiente', '#64748b', 'pending'),
    dbMode.addOption(columns.status.id, 'En curso', '#2563eb', 'in_progress'),
    dbMode.addOption(columns.status.id, 'Completo', '#16a34a', 'complete'),
    dbMode.addOption(columns.status.id, 'Bloqueado', '#dc2626', 'in_progress'),
  ];
  const tagOptions = ['producto', 'datos', 'diseño', 'qa', 'backend', 'frontend']
    .map((label, index) => dbMode.addOption(columns.tags.id, label, ['#2563eb', '#7c3aed', '#db2777'][index % 3]));
  dbMode.createView(database.id, {
    name: 'Tabla de escala', layout: 'table', filter: { conjunction: 'and', conditions: [] }, sorts: [],
  });

  const columnIds = Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, column!.id]));
  const jobId = `qascale-${randomUUID()}`;
  const started = Date.now();
  const status: QaDatabaseScaleFixtureStatus = {
    jobId, databaseId: database.id, state: 'queued', done: 0, total: input.rowCount,
    populatedCells: 0, elapsedMs: 0, message: null, columnIds,
  };
  jobs.set(jobId, status);
  const file = workerFile();
  if (!fs.existsSync(file)) throw new Error(`Worker QA no encontrado: ${file}`);
  const worker = new Worker(file, { workerData: {
    nodusDatabasePath: databasePath, jobId, databaseId: database.id,
    rowCount: input.rowCount, batchSize, columnIds,
    statusOptionIds: statusOptions.map((option) => option.id), tagOptionIds: tagOptions.map((option) => option.id),
  } });
  worker.unref();
  const publish = (patch: Partial<QaDatabaseScaleFixtureStatus>) => {
    Object.assign(status, patch, { elapsedMs: Date.now() - started });
    onProgress?.({ ...status, columnIds: { ...status.columnIds } });
  };
  worker.on('message', (message: Partial<QaDatabaseScaleFixtureStatus> & { type?: string }) => {
    publish({
      state: message.state ?? (message.type === 'complete' ? 'completed' : 'running'),
      done: message.done ?? status.done,
      populatedCells: message.populatedCells ?? status.populatedCells,
      message: message.message ?? null,
    });
  });
  worker.once('error', (error) => publish({ state: 'failed', message: error.stack ?? error.message }));
  worker.once('exit', (code) => {
    if (code !== 0 && status.state !== 'failed') publish({ state: 'failed', message: `El worker QA terminó con código ${code}.` });
  });
  publish({ state: 'running' });
  return { jobId, databaseId: database.id };
}
