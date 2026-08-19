import crypto from 'node:crypto';

export const NOTION_PARITY_SCALES = Object.freeze([1_000, 10_000, 250_000, 500_000]);

export const DATABASE_FIXTURE_SCHEMA = Object.freeze({
  headers: [
    'Nombre', 'Descripción', 'Cantidad', 'Progreso', 'Estado', 'Etiquetas',
    'Revisado', 'Fecha', 'Hora', 'Código', 'Responsable', 'URL',
  ],
  types: [
    'title', 'text', 'number', 'number', 'select', 'multi_select',
    'checkbox', 'date', 'time', 'text', 'text', 'text',
  ],
});

const statuses = ['Pendiente', 'En curso', 'Completo', 'Bloqueado'];
const people = ['Ada', 'Grace', 'Linus', 'Margaret', 'Edsger', 'Radia'];
const tags = ['producto', 'datos', 'diseño', 'qa', 'backend', 'frontend'];

export function databaseFixtureRow(index) {
  const serial = String(index + 1).padStart(7, '0');
  const day = String((index % 28) + 1).padStart(2, '0');
  const month = String((Math.floor(index / 28) % 12) + 1).padStart(2, '0');
  const hour = String(index % 24).padStart(2, '0');
  const minute = String((index * 7) % 60).padStart(2, '0');
  return [
    `Registro ${serial}`,
    `Fila determinista ${serial} para verificar búsqueda, edición y exportación.`,
    String(((index * 7919) % 100_000) / 100),
    String(index % 101),
    statuses[index % statuses.length],
    `${tags[index % tags.length]}, ${tags[(index + 2) % tags.length]}`,
    index % 3 === 0 ? 'true' : 'false',
    `202${index % 7}-${month}-${day}`,
    `${hour}:${minute}`,
    `QA-${serial}`,
    people[index % people.length],
    `https://qa.invalid/records/${serial}`,
  ];
}

/** Streaming/batched by design: asking for 500k rows must not allocate 500k arrays. */
export function* databaseFixtureBatches(rowCount, batchSize = 2_000) {
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) throw new Error('rowCount debe ser un entero no negativo.');
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error('batchSize debe ser positivo.');
  for (let start = 0; start < rowCount; start += batchSize) {
    const end = Math.min(rowCount, start + batchSize);
    const rows = [];
    for (let index = start; index < end; index += 1) rows.push(databaseFixtureRow(index));
    yield { start, end, rows };
  }
}

export function materializeDatabaseFixture(rowCount, maxRows = 10_000) {
  if (rowCount > maxRows) {
    throw new Error(`El fixture de ${rowCount} filas debe consumirse por lotes; máximo materializable: ${maxRows}.`);
  }
  return [...databaseFixtureBatches(rowCount, Math.max(1, rowCount))][0]?.rows ?? [];
}

export function databaseFixtureFingerprint(rowCount) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(DATABASE_FIXTURE_SCHEMA));
  for (const batch of databaseFixtureBatches(rowCount)) {
    for (const row of batch.rows) hash.update(`${JSON.stringify(row)}\n`);
  }
  return hash.digest('hex');
}

