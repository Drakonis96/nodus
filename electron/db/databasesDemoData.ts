// A curated Databases-mode demo: three research-flavoured databases that between them
// exercise EVERY Phase-1 column type (title, text, number, date, time, select,
// multi-select, checkbox) with coloured options and enough rows to feel real — so a
// first-time user can try inline editing, options, sorting, adding rows/columns and
// the per-database entry count/percentage without importing anything.
//
// Every id is prefixed `demo-` so the data removes surgically and can never collide
// with a user's real databases. Seeding flips the active vault to the `databases`
// type (remembering the prior type so leaving the demo restores it) and is only ever
// allowed on an empty vault. Database/column/option names follow the interface
// language; cell values (codes, species, dates) stay language-neutral or Spanish.

import { getDb } from './database';
import { getSettings, updateSettings } from './settingsRepo';
import { getActiveVault, setVaultType } from '../vaults/vaultRegistry';
import type { VaultType, DatabaseColumnType } from '@shared/types';
import { encodeMultiSelect } from '@shared/databases';

type Localized = { es: string; en: string };
function loc(v: Localized): string {
  return getSettings().uiLanguage === 'es' ? v.es : v.en;
}

// ── Declarative demo model ───────────────────────────────────────────────────────

interface DemoOption {
  key: string;
  label: Localized;
  color: string;
}
interface DemoColumn {
  key: string;
  name: Localized;
  type: DatabaseColumnType;
  options?: DemoOption[];
  config?: Record<string, unknown>;
}
/** A row is a map of column key → input value. Select = option key; multi-select =
 *  option keys; checkbox = boolean; number = number; date/time/text = string. */
type DemoCell = string | number | boolean | string[] | null | undefined;
interface DemoDatabase {
  key: string;
  name: Localized;
  icon: string;
  columns: DemoColumn[];
  rows: Record<string, DemoCell>[];
}

const C = {
  red: '#ef4444',
  orange: '#f59e0b',
  amber: '#eab308',
  green: '#10b981',
  blue: '#3b82f6',
  violet: '#8b5cf6',
  pink: '#ec4899',
  teal: '#14b8a6',
};

const DATABASES: DemoDatabase[] = [
  {
    key: 'samples',
    name: { es: 'Muestras de campo', en: 'Field samples' },
    icon: 'table',
    columns: [
      { key: 'name', name: { es: 'Nombre', en: 'Name' }, type: 'title' },
      { key: 'code', name: { es: 'Código', en: 'Code' }, type: 'text' },
      {
        key: 'species',
        name: { es: 'Especie', en: 'Species' },
        type: 'select',
        options: [
          { key: 'moss', label: { es: 'Musgo', en: 'Moss' }, color: C.green },
          { key: 'lichen', label: { es: 'Liquen', en: 'Lichen' }, color: C.teal },
          { key: 'fern', label: { es: 'Helecho', en: 'Fern' }, color: C.violet },
          { key: 'alga', label: { es: 'Alga', en: 'Alga' }, color: C.blue },
        ],
      },
      {
        key: 'habitat',
        name: { es: 'Hábitat', en: 'Habitat' },
        type: 'multi_select',
        options: [
          { key: 'forest', label: { es: 'Bosque', en: 'Forest' }, color: C.green },
          { key: 'coast', label: { es: 'Costa', en: 'Coast' }, color: C.blue },
          { key: 'mountain', label: { es: 'Montaña', en: 'Mountain' }, color: C.orange },
          { key: 'river', label: { es: 'Río', en: 'River' }, color: C.teal },
        ],
      },
      { key: 'weight', name: { es: 'Peso (g)', en: 'Weight (g)' }, type: 'number' },
      { key: 'collected', name: { es: 'Recogida', en: 'Collected' }, type: 'date' },
      { key: 'time', name: { es: 'Hora', en: 'Time' }, type: 'time' },
      { key: 'analyzed', name: { es: 'Analizada', en: 'Analyzed' }, type: 'checkbox' },
      { key: 'photo', name: { es: 'Foto', en: 'Photo' }, type: 'attachment' },
      { key: 'notes', name: { es: 'Notas', en: 'Notes' }, type: 'text' },
      {
        key: 'ai_summary',
        name: { es: 'Resumen IA', en: 'AI summary' },
        type: 'ai',
        config: { aiPrompt: 'Resume esta muestra de campo en una sola frase clara.' },
      },
    ],
    rows: [
      { name: 'Musgo alpino', code: 'MC-001', species: 'moss', habitat: ['mountain', 'forest'], weight: 12.4, collected: '2026-05-03', time: '09:15', analyzed: true, notes: 'Umbría húmeda, cara norte.' },
      { name: 'Liquen rupícola', code: 'MC-002', species: 'lichen', habitat: ['mountain'], weight: 8.1, collected: '2026-05-03', time: '10:40', analyzed: false, notes: 'Sobre granito expuesto.' },
      { name: 'Helecho umbrío', code: 'MC-003', species: 'fern', habitat: ['forest', 'river'], weight: 20.0, collected: '2026-05-11', time: '08:30', analyzed: true, notes: 'Junto a arroyo.' },
      { name: 'Alga verde', code: 'MC-004', species: 'alga', habitat: ['coast'], weight: 5.7, collected: '2026-05-18', time: '16:05', analyzed: false, notes: 'Charca intermareal.' },
      { name: 'Musgo de ribera', code: 'MC-005', species: 'moss', habitat: ['river', 'forest'], weight: 9.9, collected: '2026-05-22', time: '11:20', analyzed: true, notes: null },
      { name: 'Liquen costero', code: 'MC-006', species: 'lichen', habitat: ['coast'], weight: 3.2, collected: '2026-06-01', time: '15:45', analyzed: false, notes: 'Roca batida por el oleaje.' },
      { name: 'Helecho real', code: 'MC-007', species: 'fern', habitat: ['forest'], weight: 27.6, collected: '2026-06-09', time: '09:50', analyzed: true, notes: 'Ejemplar grande, ápice fértil.' },
      { name: 'Alga parda', code: 'MC-008', species: 'alga', habitat: ['coast'], weight: 14.3, collected: '2026-06-15', time: '17:10', analyzed: false, notes: null },
    ],
  },
  {
    key: 'experiments',
    name: { es: 'Experimentos', en: 'Experiments' },
    icon: 'table',
    columns: [
      { key: 'title', name: { es: 'Título', en: 'Title' }, type: 'title' },
      { key: 'hypothesis', name: { es: 'Hipótesis', en: 'Hypothesis' }, type: 'text' },
      {
        key: 'status',
        name: { es: 'Estado', en: 'Status' },
        type: 'select',
        options: [
          { key: 'planned', label: { es: 'Planificado', en: 'Planned' }, color: C.blue },
          { key: 'ongoing', label: { es: 'En curso', en: 'In progress' }, color: C.amber },
          { key: 'done', label: { es: 'Completado', en: 'Completed' }, color: C.green },
          { key: 'dropped', label: { es: 'Descartado', en: 'Discarded' }, color: C.red },
        ],
      },
      {
        key: 'techniques',
        name: { es: 'Técnicas', en: 'Techniques' },
        type: 'multi_select',
        options: [
          { key: 'pcr', label: { es: 'PCR', en: 'PCR' }, color: C.violet },
          { key: 'micro', label: { es: 'Microscopía', en: 'Microscopy' }, color: C.teal },
          { key: 'spectro', label: { es: 'Espectrometría', en: 'Spectrometry' }, color: C.orange },
          { key: 'culture', label: { es: 'Cultivo', en: 'Culture' }, color: C.green },
        ],
      },
      { key: 'replicates', name: { es: 'Réplicas', en: 'Replicates' }, type: 'number' },
      { key: 'start', name: { es: 'Inicio', en: 'Start' }, type: 'date' },
      { key: 'conclusive', name: { es: 'Concluyente', en: 'Conclusive' }, type: 'checkbox' },
      {
        key: 'sample',
        name: { es: 'Muestra', en: 'Sample' },
        type: 'relation',
        config: { relationTargetKind: 'db_row', relationTargetDatabaseId: 'demo-db-samples' },
      },
    ],
    rows: [
      { title: 'Germinación bajo sombra', hypothesis: 'La sombra reduce la tasa de germinación.', status: 'done', techniques: ['culture', 'micro'], replicates: 6, start: '2026-03-02', conclusive: true },
      { title: 'Tolerancia a la salinidad', hypothesis: 'El liquen costero tolera mayor salinidad que el rupícola.', status: 'ongoing', techniques: ['culture', 'spectro'], replicates: 4, start: '2026-04-14', conclusive: false },
      { title: 'Perfil pigmentario', hypothesis: 'El perfil de pigmentos discrimina especies de alga.', status: 'ongoing', techniques: ['spectro'], replicates: 3, start: '2026-05-06', conclusive: false },
      { title: 'Identificación por PCR', hypothesis: 'Los cebadores universales resuelven el género.', status: 'planned', techniques: ['pcr'], replicates: 8, start: '2026-07-01', conclusive: false },
      { title: 'Densidad estomática', hypothesis: 'La densidad estomática varía con la altitud.', status: 'done', techniques: ['micro'], replicates: 5, start: '2026-02-19', conclusive: true },
      { title: 'Contaminación cruzada', hypothesis: 'El protocolo antiguo introducía contaminación.', status: 'dropped', techniques: ['pcr', 'culture'], replicates: 2, start: '2026-01-30', conclusive: false },
    ],
  },
  {
    key: 'reading',
    name: { es: 'Lecturas', en: 'Reading list' },
    icon: 'table',
    columns: [
      { key: 'title', name: { es: 'Título', en: 'Title' }, type: 'title' },
      { key: 'authors', name: { es: 'Autores', en: 'Authors' }, type: 'text' },
      { key: 'year', name: { es: 'Año', en: 'Year' }, type: 'number' },
      {
        key: 'field',
        name: { es: 'Área', en: 'Field' },
        type: 'select',
        options: [
          { key: 'ecology', label: { es: 'Ecología', en: 'Ecology' }, color: C.green },
          { key: 'genetics', label: { es: 'Genética', en: 'Genetics' }, color: C.violet },
          { key: 'stats', label: { es: 'Estadística', en: 'Statistics' }, color: C.blue },
          { key: 'methods', label: { es: 'Métodos', en: 'Methods' }, color: C.orange },
        ],
      },
      {
        key: 'priority',
        name: { es: 'Prioridad', en: 'Priority' },
        type: 'select',
        options: [
          { key: 'high', label: { es: 'Alta', en: 'High' }, color: C.red },
          { key: 'medium', label: { es: 'Media', en: 'Medium' }, color: C.amber },
          { key: 'low', label: { es: 'Baja', en: 'Low' }, color: C.teal },
        ],
      },
      {
        key: 'tags',
        name: { es: 'Etiquetas', en: 'Tags' },
        type: 'multi_select',
        options: [
          { key: 'review', label: { es: 'revisar', en: 'review' }, color: C.orange },
          { key: 'cite', label: { es: 'citar', en: 'cite' }, color: C.green },
          { key: 'method', label: { es: 'método', en: 'method' }, color: C.blue },
          { key: 'classic', label: { es: 'clásico', en: 'classic' }, color: C.pink },
        ],
      },
      { key: 'read', name: { es: 'Leído', en: 'Read' }, type: 'checkbox' },
    ],
    rows: [
      { title: 'Numerical Ecology', authors: 'Legendre & Legendre', year: 2012, field: 'stats', priority: 'high', tags: ['method', 'classic'], read: false },
      { title: 'The R Book', authors: 'Crawley', year: 2013, field: 'methods', priority: 'medium', tags: ['method'], read: true },
      { title: 'Molecular Systematics of Lichens', authors: 'Lutzoni et al.', year: 2004, field: 'genetics', priority: 'high', tags: ['cite', 'review'], read: false },
      { title: 'Bryophyte Ecology', authors: 'Glime', year: 2017, field: 'ecology', priority: 'medium', tags: ['review'], read: false },
      { title: 'Mixed Effects Models and Extensions', authors: 'Zuur et al.', year: 2009, field: 'stats', priority: 'low', tags: ['method', 'cite'], read: true },
      { title: 'Algal Diversity and Distribution', authors: 'Round', year: 1981, field: 'ecology', priority: 'low', tags: ['classic'], read: true },
    ],
  },
];

// ── Presence check + seeding + clearing ─────────────────────────────────────────

export function hasDatabasesData(): boolean {
  const db = getDb();
  const n = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  // Any content that would make an "empty vault" no longer empty (mirrors hasAnyData).
  return (
    n('db_databases') > 0 ||
    n('works') > 0 ||
    n('ideas') > 0 ||
    n('persons') > 0 ||
    n('notes') > 0
  );
}

function optionId(dbKey: string, colKey: string, optKey: string): string {
  return `demo-opt-${dbKey}-${colKey}-${optKey}`;
}

/** Encode a declarative demo cell to the value_text the store expects for its type. */
function encodeCell(dbKey: string, col: DemoColumn, value: DemoCell): string | null {
  if (value === null || value === undefined) return null;
  switch (col.type) {
    case 'checkbox':
      return value ? '1' : '0';
    case 'number':
      return String(value);
    case 'select':
      return optionId(dbKey, col.key, String(value));
    case 'multi_select':
      return encodeMultiSelect((value as string[]).map((k) => optionId(dbKey, col.key, k)));
    default:
      return String(value);
  }
}

export function seedDatabasesDemoData(): boolean {
  const db = getDb();
  if (hasDatabasesData()) return false;

  const active = getActiveVault();
  const priorType: VaultType = active.type;
  if (priorType !== 'databases') {
    setVaultType(active.id, 'databases');
    updateSettings({ demoPriorVaultType: priorType });
  }

  const now = new Date().toISOString();
  const insDb = db.prepare(
    'INSERT INTO db_databases (id, short_id, name, icon, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insCol = db.prepare(
    'INSERT INTO db_columns (id, database_id, name, type, position, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insOpt = db.prepare(
    'INSERT INTO db_select_options (id, column_id, label, color, position) VALUES (?, ?, ?, ?, ?)'
  );
  const insRow = db.prepare(
    'INSERT INTO db_rows (id, database_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  const insCell = db.prepare('INSERT INTO db_cells (row_id, column_id, value_text) VALUES (?, ?, ?)');

  const tx = db.transaction(() => {
    DATABASES.forEach((demoDb, dbIndex) => {
      const dbId = `demo-db-${demoDb.key}`;
      const shortId = `DB-DEMO${dbIndex + 1}`;
      insDb.run(dbId, shortId, loc(demoDb.name), demoDb.icon, dbIndex, now, now);

      const colId = (colKey: string) => `demo-col-${demoDb.key}-${colKey}`;
      demoDb.columns.forEach((col, colIndex) => {
        insCol.run(colId(col.key), dbId, loc(col.name), col.type, colIndex, JSON.stringify(col.config ?? {}), now);
        (col.options ?? []).forEach((opt, optIndex) =>
          insOpt.run(optionId(demoDb.key, col.key, opt.key), colId(col.key), loc(opt.label), opt.color, optIndex)
        );
      });

      demoDb.rows.forEach((row, rowIndex) => {
        const rowId = `demo-row-${demoDb.key}-${rowIndex + 1}`;
        insRow.run(rowId, dbId, rowIndex, now, now);
        for (const col of demoDb.columns) {
          const encoded = encodeCell(demoDb.key, col, row[col.key]);
          if (encoded != null) insCell.run(rowId, colId(col.key), encoded);
        }
      });
    });

    // A few relations from Experiments → Field samples, to showcase relation columns.
    const insRel = db.prepare(
      'INSERT INTO db_relations (id, row_id, column_id, target_kind, target_id, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const relCol = 'demo-col-experiments-sample';
    const links: [string, string][] = [
      ['demo-row-experiments-1', 'demo-row-samples-1'],
      ['demo-row-experiments-2', 'demo-row-samples-2'],
      ['demo-row-experiments-3', 'demo-row-samples-4'],
      ['demo-row-experiments-5', 'demo-row-samples-3'],
    ];
    links.forEach(([rowId, targetId], i) => insRel.run(`demo-drel-${i + 1}`, rowId, relCol, 'db_row', targetId, 0, now));

    // Universal Notes and the dedicated data chat should also teach by example.
    db.prepare('INSERT INTO note_folders (id,parent_id,name,order_idx,created_at,updated_at,summary) VALUES (?,?,?,?,?,?,?)')
      .run('demo-db-note-folder', null, loc({ es: 'Cuaderno de análisis', en: 'Analysis notebook' }), 0, now, now, loc({ es: 'Conclusiones y decisiones derivadas de las bases de demostración.', en: 'Findings and decisions derived from the demo databases.' }));
    db.prepare('INSERT INTO notes (id,folder_id,title,kind,content,source_json,order_idx,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('demo-db-note-summary', 'demo-db-note-folder', loc({ es: 'Primeras observaciones', en: 'Initial observations' }), 'markdown', loc({
        es: '# Primeras observaciones\n\n- Las muestras costeras todavía tienen análisis pendientes.\n- Conviene priorizar los experimentos de salinidad y perfil pigmentario.\n- La tabla **Lecturas** reúne la bibliografía metodológica.',
        en: '# Initial observations\n\n- Coastal samples still have pending analyses.\n- Prioritize the salinity and pigment-profile experiments.\n- The **Reading list** table gathers the methodological literature.',
      }), JSON.stringify({ origin: 'database', ref: 'demo-db-samples' }), 0, now, now);
    db.prepare('INSERT INTO database_chat_conversations (id,title,database_ids_json,messages_json,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run('demo-db-chat-overview', loc({ es: 'Resumen del trabajo de campo', en: 'Fieldwork overview' }), JSON.stringify(['demo-db-samples', 'demo-db-experiments']), JSON.stringify([
        { role: 'user', content: loc({ es: '¿Qué debería revisar primero?', en: 'What should I review first?' }) },
        { role: 'assistant', content: loc({ es: 'Empieza por las muestras aún no analizadas y por los experimentos en curso. En esta demo puedes seleccionar varias bases para compararlas en una sola conversación.', en: 'Start with samples that are not yet analyzed and experiments in progress. In this demo you can select multiple databases and compare them in one conversation.' }) },
      ]), now, now);
  });
  tx();
  // Flag demo mode (so the exit-demo banner shows and the data is never mistaken
  // for a real library) and re-arm the guided databases tour, mirroring the
  // academic and genealogy demos.
  updateSettings({ demoMode: true, databasesTourComplete: false });
  return true;
}

export function clearDatabasesDemoData(): void {
  const db = getDb();
  const tx = db.transaction(() => {
    // Cells/options cascade via FKs, but delete explicitly so a partial demo also clears.
    db.exec(`
      DELETE FROM database_chat_conversations WHERE id LIKE 'demo-%';
      DELETE FROM notes WHERE id LIKE 'demo-db-%';
      DELETE FROM note_folders WHERE id LIKE 'demo-db-%';
      DELETE FROM db_relations WHERE id LIKE 'demo-%' OR row_id LIKE 'demo-%' OR column_id LIKE 'demo-%';
      DELETE FROM db_attachments WHERE id LIKE 'demo-%' OR row_id LIKE 'demo-%' OR column_id LIKE 'demo-%';
      DELETE FROM db_cells WHERE row_id LIKE 'demo-%' OR column_id LIKE 'demo-%';
      DELETE FROM db_select_options WHERE id LIKE 'demo-%' OR column_id LIKE 'demo-%';
      DELETE FROM db_rows WHERE id LIKE 'demo-%';
      DELETE FROM db_columns WHERE id LIKE 'demo-%';
      DELETE FROM db_databases WHERE id LIKE 'demo-%';
    `);
    const prior = getSettings().demoPriorVaultType;
    if (prior) {
      setVaultType(getActiveVault().id, prior);
      updateSettings({ demoPriorVaultType: null });
    }
  });
  tx();
}
