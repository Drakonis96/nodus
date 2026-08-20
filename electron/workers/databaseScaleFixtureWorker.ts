import { parentPort, workerData } from 'node:worker_threads';
import { getDb } from '../db/database';

interface WorkerInput {
  jobId: string;
  databaseId: string;
  rowCount: number;
  batchSize: number;
  columnIds: Record<string, string>;
  statusOptionIds: string[];
  tagOptionIds: string[];
}

const input = workerData as WorkerInput;
const db = getDb();
const searchableTypes = "'title','rich_text','text','select','status','multi_select','person','url','email','phone','location'";
const restoreInsertTriggersSql = `
  CREATE TRIGGER IF NOT EXISTS db_cells_search_ai AFTER INSERT ON db_cells
  WHEN EXISTS (
    SELECT 1 FROM db_columns col WHERE col.id = new.column_id AND col.database_id = new.database_id
      AND col.type IN (${searchableTypes})
  ) BEGIN
    INSERT INTO db_search_fts(rowid, content, entity_type, database_id, row_id, column_id, entity_id)
    SELECT new.rowid, CASE
             WHEN col.type IN ('select','status') THEN COALESCE(
               (SELECT option.label FROM db_select_options option
                WHERE option.id = COALESCE(new.value_reference, new.value_text)), new.value_text, '')
             WHEN col.type = 'multi_select' AND json_valid(COALESCE(new.value_json, new.value_text)) THEN COALESCE(
               (SELECT group_concat(COALESCE(option.label, item.value), ' ')
                FROM json_each(COALESCE(new.value_json, new.value_text)) item
                LEFT JOIN db_select_options option ON option.id = item.value), new.value_text, '')
             ELSE COALESCE(new.value_text, '')
           END,
           'cell', new.database_id, new.row_id, new.column_id, new.row_id || ':' || new.column_id
    FROM db_columns col WHERE col.id = new.column_id AND col.database_id = new.database_id;
  END;
  CREATE TRIGGER IF NOT EXISTS db_computed_cells_search_ai AFTER INSERT ON db_computed_cells
  WHEN new.value_type NOT IN ('number','integer') BEGIN
    INSERT INTO db_search_fts(rowid, content, entity_type, database_id, row_id, column_id, entity_id)
    VALUES (-new.rowid, COALESCE(new.value_text, ''), 'computed', new.database_id, new.row_id, new.column_id,
            new.row_id || ':' || new.column_id);
  END;
  CREATE TRIGGER IF NOT EXISTS pages_search_ai AFTER INSERT ON pages WHEN new.state='active' AND new.row_id IS NULL BEGIN
    INSERT INTO db_search_fts(rowid,content,entity_type,database_id,row_id,column_id,entity_id)
    SELECT 4611686018427387904+new.rowid,new.title,'page_title',row.database_id,new.row_id,NULL,new.id
    FROM (SELECT 1) seed LEFT JOIN db_rows row ON row.id=new.row_id;
  END;
`;
const restorePageInsertTriggersSql = `
  CREATE TRIGGER IF NOT EXISTS pages_db_rows_ai AFTER INSERT ON db_rows BEGIN
    INSERT OR IGNORE INTO pages
      (id, row_id, origin, title, created_at, updated_at, revision, created_by, updated_by)
    VALUES ('row:' || new.id, new.id, 'database_row', '', new.created_at, new.updated_at,
            new.revision, new.created_by, new.updated_by);
    INSERT OR IGNORE INTO page_documents
      (page_id, revision, snapshot_sequence, next_update_sequence, snapshot_blob, state_vector,
       markdown_hash, update_count, created_at, updated_at)
    VALUES ('row:' || new.id, 1, 0, 1, X'', X'',
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 0,
            new.created_at, new.updated_at);
    INSERT OR IGNORE INTO page_document_snapshots
      (id, page_id, sequence_no, revision, snapshot_blob, state_vector, markdown_hash, created_at)
    VALUES ('initial-row:' || new.id, 'row:' || new.id, 0, 1, X'', X'',
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', new.created_at);
  END;
  CREATE TRIGGER IF NOT EXISTS pages_title_cell_ai AFTER INSERT ON db_cells
  WHEN EXISTS (SELECT 1 FROM db_columns col WHERE col.id = new.column_id AND col.type = 'title') BEGIN
    UPDATE pages SET title = COALESCE(new.value_text, ''), revision = revision + 1,
      updated_at = new.updated_at, updated_by = new.updated_by WHERE row_id = new.row_id;
  END;
`;
const restoreBulkIndexesSql = `
  CREATE INDEX IF NOT EXISTS idx_db_cells_column ON db_cells(database_id, column_id);
  CREATE INDEX IF NOT EXISTS idx_db_cells_row ON db_cells(database_id, row_id);
  CREATE INDEX IF NOT EXISTS idx_db_cells_text_value
    ON db_cells(database_id, column_id, value_text COLLATE NOCASE, row_id) WHERE value_text IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_db_cells_number_value
    ON db_cells(database_id, column_id, value_number, row_id) WHERE value_number IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_db_cells_integer_value
    ON db_cells(database_id, column_id, value_integer, row_id) WHERE value_integer IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_db_cells_date_value
    ON db_cells(database_id, column_id, value_date, row_id) WHERE value_date IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_db_cells_reference_value
    ON db_cells(database_id, column_id, value_reference, row_id) WHERE value_reference IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_db_relations_cell ON db_relations(database_id, row_id, column_id);
  CREATE INDEX IF NOT EXISTS idx_db_relations_target
    ON db_relations(target_kind, target_id, database_id, column_id, row_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_db_relations_unique_target
    ON db_relations(row_id, column_id, target_kind, target_id, COALESCE(target_vault_id, ''));
  CREATE INDEX IF NOT EXISTS idx_db_relations_inverse ON db_relations(inverse_relation_id);
  CREATE INDEX IF NOT EXISTS idx_db_computed_column ON db_computed_cells(database_id, column_id, row_id);
  CREATE INDEX IF NOT EXISTS idx_db_computed_number
    ON db_computed_cells(database_id, column_id, value_number, row_id) WHERE value_number IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_db_computed_date
    ON db_computed_cells(database_id, column_id, value_date, row_id) WHERE value_date IS NOT NULL;
`;
const timestamp = '2026-08-19T12:00:00.000Z';
const commonParams = {
  databaseId: input.databaseId,
  timestamp,
  ...Object.fromEntries(Object.entries(input.columnIds).map(([key, value]) => [`column_${key}`, value])),
  ...Object.fromEntries(input.statusOptionIds.map((value, index) => [`status_${index}`, value])),
  ...Object.fromEntries(input.tagOptionIds.map((value, index) => [`tag_${index}`, value])),
};

// A temporary integer batch turns millions of JS -> native statement calls into a few
// set-based INSERTs. It deliberately uses the same typed values and compatibility text
// projection as the public writer so the fixture remains representative of a real vault.
db.exec('CREATE TEMP TABLE qa_scale_batch(index_value INTEGER PRIMARY KEY) WITHOUT ROWID;');
const populateBatch = db.prepare(
  `INSERT INTO temp.qa_scale_batch(index_value)
   WITH RECURSIVE sequence(value) AS (
     VALUES (@start)
     UNION ALL SELECT value + 1 FROM sequence WHERE value + 1 < @end
   ) SELECT value FROM sequence`,
);
const insertRows = db.prepare(
  `INSERT INTO db_rows
    (id, database_id, position, unique_sequence, created_at, updated_at, revision, created_by, updated_by)
   SELECT 'qa19-' || @databaseId || '-' || printf('%07d', index_value + 1),
          @databaseId, index_value, index_value + 1, @timestamp, @timestamp, 1, 'qa-scale', 'qa-scale'
   FROM temp.qa_scale_batch`,
);
const insertCells = db.prepare(
  `WITH base AS (
     SELECT index_value,
            'qa19-' || @databaseId || '-' || printf('%07d', index_value + 1) AS row_id,
            printf('%07d', index_value + 1) AS serial,
            ((index_value * 7919) % 100000) / 100.0 AS amount,
            index_value % 101 AS progress,
            printf('202%d-%02d-%02d', index_value % 7,
              (CAST(index_value / 28 AS INTEGER) % 12) + 1, (index_value % 28) + 1) AS date_value
     FROM temp.qa_scale_batch
   )
   INSERT INTO db_cells
     (database_id, row_id, column_id, value_type, value_text, value_number, value_integer,
      value_date, value_json, value_reference, revision, created_by, updated_by, created_at, updated_at)
   SELECT @databaseId, row_id, @column_title, 'text', 'Registro ' || serial,
          NULL, NULL, NULL, NULL, NULL, 1, 'qa-scale', 'qa-scale', @timestamp, @timestamp FROM base
   UNION ALL SELECT @databaseId, row_id, @column_description, 'text',
          'Fila determinista ' || serial || ' para verificar búsqueda, edición y exportación a gran escala.',
          NULL, NULL, NULL, NULL, NULL, 1, 'qa-scale', 'qa-scale', @timestamp, @timestamp FROM base
   UNION ALL SELECT @databaseId, row_id, @column_amount, 'number', CAST(amount AS TEXT),
          amount, NULL, NULL, NULL, NULL, 1, 'qa-scale', 'qa-scale', @timestamp, @timestamp FROM base
   UNION ALL SELECT @databaseId, row_id, @column_progress, 'number', CAST(progress AS TEXT),
          progress, NULL, NULL, NULL, NULL, 1, 'qa-scale', 'qa-scale', @timestamp, @timestamp FROM base
   UNION ALL SELECT @databaseId, row_id, @column_status, 'reference',
          CASE index_value % 4 WHEN 0 THEN @status_0 WHEN 1 THEN @status_1 WHEN 2 THEN @status_2 ELSE @status_3 END,
          NULL, NULL, NULL, NULL,
          CASE index_value % 4 WHEN 0 THEN @status_0 WHEN 1 THEN @status_1 WHEN 2 THEN @status_2 ELSE @status_3 END,
          1, 'qa-scale', 'qa-scale', @timestamp, @timestamp FROM base
   UNION ALL SELECT @databaseId, row_id, @column_tags, 'json',
          json_array(
            CASE index_value % 6 WHEN 0 THEN @tag_0 WHEN 1 THEN @tag_1 WHEN 2 THEN @tag_2 WHEN 3 THEN @tag_3 WHEN 4 THEN @tag_4 ELSE @tag_5 END,
            CASE (index_value + 2) % 6 WHEN 0 THEN @tag_0 WHEN 1 THEN @tag_1 WHEN 2 THEN @tag_2 WHEN 3 THEN @tag_3 WHEN 4 THEN @tag_4 ELSE @tag_5 END),
          NULL, NULL, NULL,
          json_array(
            CASE index_value % 6 WHEN 0 THEN @tag_0 WHEN 1 THEN @tag_1 WHEN 2 THEN @tag_2 WHEN 3 THEN @tag_3 WHEN 4 THEN @tag_4 ELSE @tag_5 END,
            CASE (index_value + 2) % 6 WHEN 0 THEN @tag_0 WHEN 1 THEN @tag_1 WHEN 2 THEN @tag_2 WHEN 3 THEN @tag_3 WHEN 4 THEN @tag_4 ELSE @tag_5 END),
          NULL, 1, 'qa-scale', 'qa-scale', @timestamp, @timestamp FROM base
   UNION ALL SELECT @databaseId, row_id, @column_checked, 'integer', CAST(index_value % 3 = 0 AS TEXT),
          NULL, index_value % 3 = 0, NULL, NULL, NULL, 1, 'qa-scale', 'qa-scale', @timestamp, @timestamp FROM base
   UNION ALL SELECT @databaseId, row_id, @column_date, 'date', date_value,
          NULL, NULL, date_value, NULL, NULL, 1, 'qa-scale', 'qa-scale', @timestamp, @timestamp FROM base
   UNION ALL SELECT @databaseId, row_id, @column_email, 'text', 'registro-' || serial || '@qa.invalid',
          NULL, NULL, NULL, NULL, NULL, 1, 'qa-scale', 'qa-scale', @timestamp, @timestamp FROM base
   UNION ALL SELECT @databaseId, row_id, @column_url, 'text', 'https://qa.invalid/records/' || serial,
          NULL, NULL, NULL, NULL, NULL, 1, 'qa-scale', 'qa-scale', @timestamp, @timestamp FROM base
   UNION ALL SELECT @databaseId, row_id, @column_phone, 'text', '+34 600 ' || printf('%06d', index_value % 1000000),
          NULL, NULL, NULL, NULL, NULL, 1, 'qa-scale', 'qa-scale', @timestamp, @timestamp FROM base
   UNION ALL SELECT @databaseId, row_id, @column_location, 'json',
          CASE index_value % 2 WHEN 0 THEN json_object('label','Barcelona','latitude',41.3874,'longitude',2.1686)
            ELSE json_object('label','Madrid','latitude',40.4168,'longitude',-3.7038) END,
          NULL, NULL, NULL,
          CASE index_value % 2 WHEN 0 THEN json_object('label','Barcelona','latitude',41.3874,'longitude',2.1686)
            ELSE json_object('label','Madrid','latitude',40.4168,'longitude',-3.7038) END,
          NULL, 1, 'qa-scale', 'qa-scale', @timestamp, @timestamp FROM base
   UNION ALL SELECT @databaseId, row_id, @column_person, 'json',
          json_array(json_object('id','qa-person-' || (index_value % 6), 'name',
            CASE index_value % 6 WHEN 0 THEN 'Ada' WHEN 1 THEN 'Grace' WHEN 2 THEN 'Linus'
              WHEN 3 THEN 'Margaret' WHEN 4 THEN 'Edsger' ELSE 'Radia' END)),
          NULL, NULL, NULL,
          json_array(json_object('id','qa-person-' || (index_value % 6), 'name',
            CASE index_value % 6 WHEN 0 THEN 'Ada' WHEN 1 THEN 'Grace' WHEN 2 THEN 'Linus'
              WHEN 3 THEN 'Margaret' WHEN 4 THEN 'Edsger' ELSE 'Radia' END)),
          NULL, 1, 'qa-scale', 'qa-scale', @timestamp, @timestamp FROM base
   UNION ALL SELECT @databaseId, row_id, @column_code, 'text', 'QA-' || serial,
          NULL, NULL, NULL, NULL, NULL, 1, 'qa-scale', 'qa-scale', @timestamp, @timestamp FROM base`,
);
const insertRelations = db.prepare(
  `INSERT INTO db_relations
    (id, database_id, row_id, column_id, target_kind, target_id, target_vault_id, position,
     revision, created_by, updated_by, created_at, updated_at, last_known_label)
   SELECT 'qa19-rel-' || @databaseId || '-' || printf('%07d', index_value + 1), @databaseId,
          'qa19-' || @databaseId || '-' || printf('%07d', index_value + 1), @column_relation, 'db_row',
          'qa19-' || @databaseId || '-' || printf('%07d', index_value), NULL, 0, 1,
          'qa-scale', 'qa-scale', @timestamp, @timestamp, 'Registro ' || printf('%07d', index_value)
   FROM temp.qa_scale_batch WHERE index_value > 0`,
);
const insertComputed = db.prepare(
  `WITH base AS (
     SELECT index_value,
            'qa19-' || @databaseId || '-' || printf('%07d', index_value + 1) AS row_id,
            ((index_value * 7919) % 100000) / 100.0 AS amount,
            index_value % 101 AS progress,
            CASE WHEN index_value = 0 THEN 0
              ELSE (((index_value - 1) * 7919) % 100000) / 100.0 END AS previous_amount
     FROM temp.qa_scale_batch
   )
   INSERT INTO db_computed_cells
     (database_id, row_id, column_id, computed_kind, value_type, value_text, value_number,
      value_integer, value_date, value_json, color, error, source_revision, revision, updated_at)
   SELECT @databaseId, row_id, @column_formula, 'formula', 'number', CAST(amount + progress AS TEXT),
          amount + progress, NULL, NULL, NULL, NULL, NULL, 1, 1, @timestamp FROM base
   UNION ALL
   SELECT @databaseId, row_id, @column_rollup, 'rollup', 'number', CAST(previous_amount AS TEXT),
          previous_amount, NULL, NULL, NULL, NULL, NULL, 1, 1, @timestamp FROM base`,
);

let done = 0;
let insertTriggersSuspended = false;
let pageInsertTriggersSuspended = false;
let bulkIndexesSuspended = false;
try {
  db.pragma('wal_autocheckpoint = 100000');
  db.pragma('cache_size = -262144');
  db.pragma('mmap_size = 1073741824');
  db.pragma('temp_store = MEMORY');
  // The fixture is one authorized bulk operation. Maintaining an FTS b-tree once per
  // cell multiplies import time; populate the same projection set-wise after the rows
  // commit, then restore normal incremental triggers before the application can edit.
  db.exec(`DROP TRIGGER db_cells_search_ai; DROP TRIGGER db_computed_cells_search_ai; DROP TRIGGER pages_search_ai;
    DROP TRIGGER pages_db_rows_ai; DROP TRIGGER pages_title_cell_ai;`);
  insertTriggersSuspended = true;
  pageInsertTriggersSuspended = true;
  db.exec(`
    DROP INDEX IF EXISTS idx_db_cells_column; DROP INDEX IF EXISTS idx_db_cells_row;
    DROP INDEX IF EXISTS idx_db_cells_text_value; DROP INDEX IF EXISTS idx_db_cells_number_value;
    DROP INDEX IF EXISTS idx_db_cells_integer_value; DROP INDEX IF EXISTS idx_db_cells_date_value;
    DROP INDEX IF EXISTS idx_db_cells_reference_value; DROP INDEX IF EXISTS idx_db_relations_cell;
    DROP INDEX IF EXISTS idx_db_relations_target; DROP INDEX IF EXISTS idx_db_relations_unique_target;
    DROP INDEX IF EXISTS idx_db_relations_inverse; DROP INDEX IF EXISTS idx_db_computed_column;
    DROP INDEX IF EXISTS idx_db_computed_number; DROP INDEX IF EXISTS idx_db_computed_date;
  `);
  bulkIndexesSuspended = true;
  for (let start = 0; start < input.rowCount; start += input.batchSize) {
    const end = Math.min(input.rowCount, start + input.batchSize);
    db.transaction(() => {
      db.exec('DELETE FROM temp.qa_scale_batch;');
      populateBatch.run({ start, end });
      insertRows.run(commonParams);
      insertCells.run(commonParams);
      insertRelations.run(commonParams);
      insertComputed.run(commonParams);
      db.prepare("UPDATE db_databases SET revision = revision + 1, updated_at = ?, updated_by = 'qa-scale' WHERE id = ?")
        .run(timestamp, input.databaseId);
    })();
    done = end;
    parentPort?.postMessage({ type: 'progress', state: 'running', done, populatedCells: done * 14 });
  }
  parentPort?.postMessage({ type: 'progress', state: 'running', done, populatedCells: done * 14, message: 'Materializando páginas…' });
  db.transaction(() => {
    db.prepare(
      `INSERT INTO pages
        (id, row_id, origin, title, created_at, updated_at, revision, created_by, updated_by)
       SELECT 'row:' || row.id, row.id, 'database_row', COALESCE(title.value_text, ''),
              row.created_at, row.updated_at, row.revision, row.created_by, row.updated_by
       FROM db_rows row LEFT JOIN db_cells title
         ON title.database_id = row.database_id AND title.row_id = row.id AND title.column_id = ?
       WHERE row.database_id = ?`,
    ).run(input.columnIds.title, input.databaseId);
    db.prepare(
      `INSERT INTO page_documents
        (page_id, revision, snapshot_sequence, next_update_sequence, snapshot_blob, state_vector,
         markdown_hash, update_count, created_at, updated_at)
       SELECT 'row:' || id, 1, 0, 1, X'', X'',
              'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 0,
              created_at, updated_at FROM db_rows WHERE database_id = ?`,
    ).run(input.databaseId);
    db.prepare(
      `INSERT INTO page_document_snapshots
        (id, page_id, sequence_no, revision, snapshot_blob, state_vector, markdown_hash, created_at)
       SELECT 'initial-row:' || id, 'row:' || id, 0, 1, X'', X'',
              'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', created_at
       FROM db_rows WHERE database_id = ?`,
    ).run(input.databaseId);
  })();
  db.exec(restorePageInsertTriggersSql);
  pageInsertTriggersSuspended = false;
  parentPort?.postMessage({ type: 'progress', state: 'running', done, populatedCells: done * 14, message: 'Indexando texto…' });
  db.prepare(
    `INSERT INTO db_search_fts(rowid, content, entity_type, database_id, row_id, column_id, entity_id)
     SELECT cell.rowid, CASE
              WHEN col.type IN ('select','status') THEN COALESCE(
                (SELECT option.label FROM db_select_options option
                 WHERE option.id = COALESCE(cell.value_reference, cell.value_text)), cell.value_text, '')
              WHEN col.type = 'multi_select' AND json_valid(COALESCE(cell.value_json, cell.value_text)) THEN COALESCE(
                (SELECT group_concat(COALESCE(option.label, item.value), ' ')
                 FROM json_each(COALESCE(cell.value_json, cell.value_text)) item
                 LEFT JOIN db_select_options option ON option.id = item.value), cell.value_text, '')
              ELSE COALESCE(cell.value_text, '')
            END,
            'cell', cell.database_id, cell.row_id, cell.column_id, cell.row_id || ':' || cell.column_id
     FROM db_cells cell JOIN db_columns col
       ON col.id = cell.column_id AND col.database_id = cell.database_id
     WHERE cell.database_id = ? AND col.type IN (${searchableTypes})`,
  ).run(input.databaseId);
  db.exec(restoreInsertTriggersSql);
  insertTriggersSuspended = false;
  parentPort?.postMessage({ type: 'progress', state: 'running', done, populatedCells: done * 14, message: 'Construyendo índices tipados…' });
  db.exec(restoreBulkIndexesSql);
  bulkIndexesSuspended = false;
  db.pragma('optimize');
  // Publish completion only after the large WAL is durable and truncated. Otherwise the
  // first user edit inherits the checkpoint and appears hundreds of milliseconds slower
  // even though the import worker is the operation that created that work.
  db.pragma('wal_checkpoint(TRUNCATE)');
  parentPort?.postMessage({ type: 'complete', state: 'completed', done, populatedCells: done * 14 });
} catch (error) {
  if (insertTriggersSuspended) {
    try { db.exec(restoreInsertTriggersSql); } catch { /* QA database is discarded after a failed gate. */ }
  }
  if (pageInsertTriggersSuspended) {
    try { db.exec(restorePageInsertTriggersSql); } catch { /* QA database is discarded after a failed gate. */ }
  }
  if (bulkIndexesSuspended) {
    try { db.exec(restoreBulkIndexesSql); } catch { /* QA database is discarded after a failed gate. */ }
  }
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  parentPort?.postMessage({ type: 'complete', state: 'failed', done, populatedCells: done * 14, message });
  process.exitCode = 1;
} finally {
  db.close();
}
