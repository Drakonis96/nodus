import type Database from 'better-sqlite3';

export interface TableColumn { name: string; pk: number; notnull: number }

export const IDENTITY_OVERRIDES: Record<string, string[]> = {
  study_schedule_day_styles: ['day', 'academic_year_id'],
};

export function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Identificador de tabla no válido.');
  return `"${value}"`;
}

export function tableColumnsInDatabase(db: Database.Database, table: string): TableColumn[] {
  return db.pragma(`table_info(${quoteIdentifier(table)})`) as TableColumn[];
}

export function identityColumnsInDatabase(
  db: Database.Database,
  table: string,
  columns = tableColumnsInDatabase(db, table),
): string[] {
  const pk = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
  if (pk.length > 0) return pk;
  const override = IDENTITY_OVERRIDES[table];
  const names = new Set(columns.map((column) => column.name));
  if (override && override.every((name) => names.has(name))) return override;
  const indexes = db.pragma(`index_list(${quoteIdentifier(table)})`) as { name: string; unique: number }[];
  for (const index of indexes) {
    if (index.unique !== 1) continue;
    const info = db.pragma(`index_info(${JSON.stringify(index.name)})`) as { name: string | null }[];
    if (info.length > 0 && info.every((entry) => typeof entry.name === 'string')) {
      return info.map((entry) => entry.name as string);
    }
  }
  return [];
}

export function identityWhere(columns: TableColumn[], identity: string[]): string {
  const notNull = new Set(columns.filter((column) => column.notnull === 1 || column.pk > 0).map((column) => column.name));
  return identity.map((key) => `${quoteIdentifier(key)} ${notNull.has(key) ? '=' : 'IS'} ?`).join(' AND ');
}
