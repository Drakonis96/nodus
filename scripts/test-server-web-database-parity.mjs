import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createCorpusRoutes } from '../server/lib/routes/corpus.mjs';
import { lexicalSearch } from '../server/lib/core/search.mjs';

const root = path.resolve(import.meta.dirname, '..');
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');
const readSource = (file) => readFile(path.join(root, file), 'utf8').then(variants);

test('published database analysis has a complete immutable projection and Web adapter', async () => {
  const corpus = await readSource('server/lib/routes/corpus.mjs');
  const snapshot = await readSource('electron/serverSync/serverSnapshot.ts');
  const view = await readSource('src/serverWeb/DatabaseAnalysisServerView.tsx');
  const app = await readSource('src/serverWeb/App.tsx');
  assert.match(corpus, /head === 'databases' && rest\[1\] === 'analysis'/);
  assert.match(corpus, /db_computed_cells/);
  assert.match(corpus, /cellsByRow/);
  assert.match(corpus, /attachmentsByRow/);
  assert.match(corpus, /relationCountsByRow/);
  assert.match(corpus, /views: rows\(snapshot, 'db_views'\)/);
  assert.match(snapshot, /'db_cells', 'db_computed_cells', 'db_views'/);
  assert.match(view, /data-testid="published-database-analysis"/);
  assert.match(view, /data-testid="published-analysis-constructor"/);
  assert.match(view, /computeDatabaseAnalysis/);
  assert.match(view, /validateRequest/);
  assert.match(view, /api\.databaseAnalysis/);
  assert.match(app, /route\.view === 'dbAnalysis'[\s\S]*?<DatabaseAnalysisServerView/);
  assert.doesNotMatch(view, /window\.nodus\.(?:runDatabaseAnalysis|analyzeDatabaseReport|suggestDatabaseAnalyses)/,
    'published analysis must not call private Desktop IPC or AI actions');
});

test('database search searches db_rows content in the published lexical contract', async () => {
  const search = await readSource('server/lib/core/search.mjs');
  assert.match(search, /'db_databases'/);
  assert.match(search, /'pages'/);
  assert.match(search, /db_rows/);
  const hits = lexicalSearch({ tables: {
    db_databases: [{ id: 'db1', name: 'Inventario' }],
    db_columns: [{ id: 'title', database_id: 'db1', name: 'Nombre', type: 'title' }],
    db_rows: [{ id: 'row1', database_id: 'db1' }],
    db_cells: [{ row_id: 'row1', column_id: 'title', value_text: 'Elemento buscable' }],
  } }, 'buscable', 20);
  assert.deepEqual(hits, [{ type: 'db_rows', id: 'db1', title: 'Elemento buscable · Inventario', excerpt: 'Nombre: Elemento buscable' }]);
});

test('database analysis endpoint projects rows, typed cells, computed values, relations and options', async () => {
  const snapshot = { tables: {
    db_databases: [{ id: 'db1', name: 'Inventario' }],
    db_columns: [{ id: 'title', database_id: 'db1', name: 'Nombre', type: 'title', position: 0, config_json: '{}' }, { id: 'amount', database_id: 'db1', name: 'Importe', type: 'number', position: 1, config_json: '{}' }],
    db_select_options: [{ id: 'opt1', column_id: 'amount', label: 'Uno', color: null, position: 0 }],
    db_rows: [{ id: 'row1', database_id: 'db1', position: 0, created_at: '2024-01-01', updated_at: '2024-01-01' }],
    db_cells: [{ row_id: 'row1', column_id: 'title', value_text: 'Registro A' }, { row_id: 'row1', column_id: 'amount', value_number: 12, value_text: '12' }],
    db_computed_cells: [{ row_id: 'row1', column_id: 'amount', value_number: 13, value_text: '13' }],
    db_relations: [{ row_id: 'row1', column_id: 'amount', target_id: 'row2', position: 0 }],
    db_attachments: [{ id: 'att1', row_id: 'row1', column_id: 'title', file_name: 'foto.png', mime_type: 'image/png', bytes: 3, blob_hash: null, position: 0 }],
    db_views: [{ id: 'view1', database_id: 'db1', name: 'Tabla', layout: 'table', filter_json: null, sort_json: null, config_json: null, position: 0 }],
  } };
  const before = JSON.stringify(snapshot);
  let body;
  const res = { writeHead() {}, end() {} };
  const json = (_res, _status, value) => { body = value; };
  const routes = createCorpusRoutes({ readSnapshot: () => snapshot });
  const answered = await routes.handle({ headers: {} }, res, { json, url: new URL('https://example.test/api/v1/spaces/s1/databases/db1/analysis'), space: { id: 's1', revision: 1 }, segments: ['databases', 'db1', 'analysis'] });
  assert.equal(answered, true);
  assert.equal(body.columns[1].id, 'amount');
  assert.equal(body.rows[0].cells.title, 'Registro A');
  assert.equal(body.rows[0].cells.amount, '13');
  assert.equal(body.rows[0].relationCounts.amount, 1);
  assert.equal(body.rows[0].attachments.title[0].fileName, 'foto.png');
  assert.equal(body.views[0].layout, 'table');
  assert.equal(JSON.stringify(snapshot), before, 'the endpoint must not mutate the published snapshot');
});
