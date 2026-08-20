// Loop 8 acceptance: real SQLite relations, typed rollups and the safe formula AST.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const marker = '--electron-database-relations-formulas-test';
if (!process.argv.includes(marker)) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-relations-formulas-'));
installRuntimeHooks(root);
try {
  const Database = require('better-sqlite3');
  const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const repo = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const domain = require(path.join(repoRoot, 'shared/databases.ts'));
  const properties = require(path.join(repoRoot, 'shared/databaseProperties.ts'));
  const formulas = require(path.join(repoRoot, 'shared/databaseFormula.ts'));
  const formulaEval = require(path.join(repoRoot, 'shared/databaseFormulaEval.ts'));
  const expressions = require(path.join(repoRoot, 'shared/databaseFormulaExpression.ts'));

  const sqlite = new Database(path.join(root, 'loop-08.sqlite'));
  runMigrations(sqlite);
  globalThis.__databaseRelationsFormulasDb = sqlite;
  assert.equal(sqlite.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, Math.max(...migrations.map((migration) => migration.version)));
  const relationColumns = sqlite.prepare('PRAGMA table_info(db_relations)').all().map((column) => column.name);
  assert.ok(relationColumns.includes('inverse_relation_id'));
  assert.ok(relationColumns.includes('last_known_label'));

  const projects = repo.createDatabase('Proyectos');
  const tasks = repo.createDatabase('Tareas');
  const projectTitle = repo.createColumn(projects.id, 'Proyecto', 'title');
  const taskTitle = repo.createColumn(tasks.id, 'Tarea', 'title');
  const projectTasks = repo.createColumn(projects.id, 'Tareas', 'relation', {
    relationTargetKind: 'db_row', relationTargetDatabaseId: tasks.id, relationCardinality: 'many',
  });
  const taskProject = repo.createColumn(tasks.id, 'Proyecto', 'relation', {
    relationTargetKind: 'db_row', relationTargetDatabaseId: projects.id, relationCardinality: 'one',
    relationInverseColumnId: projectTasks.id,
  });
  repo.updateColumn(projectTasks.id, { config: {
    ...projectTasks.config, relationTargetKind: 'db_row', relationTargetDatabaseId: tasks.id,
    relationCardinality: 'many', relationInverseColumnId: taskProject.id,
  } });

  const p1 = repo.createRow(projects.id); const p2 = repo.createRow(projects.id);
  const t1 = repo.createRow(tasks.id); const t2 = repo.createRow(tasks.id);
  repo.setCell(p1.id, projectTitle.id, 'Atlas'); repo.setCell(p2.id, projectTitle.id, 'Bóreas');
  repo.setCell(t1.id, taskTitle.id, 'Diseñar'); repo.setCell(t2.id, taskTitle.id, 'Probar');

  const first = repo.addRelation(t1.id, taskProject.id, 'db_row', p1.id);
  assert.ok(first.inverseRelationId, 'a bidirectional relation creates its inverse');
  assert.equal(repo.listRelations(p1.id, projectTasks.id)[0].targetId, t1.id);
  const replacement = repo.addRelation(t1.id, taskProject.id, 'db_row', p2.id);
  assert.equal(repo.listRelations(t1.id, taskProject.id).length, 1, 'one cardinality replaces atomically');
  assert.equal(replacement.targetId, p2.id);
  assert.equal(repo.listRelations(p1.id, projectTasks.id).length, 0, 'the old inverse is cascaded');
  assert.equal(repo.listRelations(p2.id, projectTasks.id)[0].targetId, t1.id);
  assert.throws(() => repo.addRelation(t1.id, taskProject.id, 'db_row', t2.id), /base distinta/);

  const people = repo.createDatabase('Personas');
  const personTitle = repo.createColumn(people.id, 'Nombre', 'title');
  const friends = repo.createColumn(people.id, 'Amistades', 'relation', {
    relationTargetKind: 'db_row', relationTargetDatabaseId: people.id, relationCardinality: 'many',
  });
  repo.updateColumn(friends.id, { config: { ...friends.config, relationTargetKind: 'db_row',
    relationTargetDatabaseId: people.id, relationCardinality: 'many', relationInverseColumnId: friends.id } });
  const ada = repo.createRow(people.id); const grace = repo.createRow(people.id);
  repo.setCell(ada.id, personTitle.id, 'Ada'); repo.setCell(grace.id, personTitle.id, 'Grace');
  const friendship = repo.addRelation(ada.id, friends.id, 'db_row', grace.id);
  assert.equal(repo.listRelations(grace.id, friends.id)[0].targetId, ada.id, 'self database inverse works');
  repo.removeRelation(friendship.id);
  assert.equal(repo.listRelations(ada.id, friends.id).length + repo.listRelations(grace.id, friends.id).length, 0);

  // Historical/imported links can be broken. Their last label survives and repair is audited.
  const watchers = repo.createColumn(tasks.id, 'Observa', 'relation', {
    relationTargetKind: 'db_row', relationTargetDatabaseId: projects.id, relationCardinality: 'many',
  });
  const brokenCandidate = repo.addRelation(t2.id, watchers.id, 'db_row', p1.id);
  sqlite.prepare('DELETE FROM db_rows WHERE id = ?').run(p1.id); // deliberately bypass repository cascade
  const broken = repo.listRelations(t2.id, watchers.id)[0];
  assert.equal(broken.broken, true);
  assert.equal(broken.label, 'Atlas', 'last known label is retained');
  const repaired = repo.repairRelation(brokenCandidate.id, p2.id);
  assert.equal(repaired.broken, false); assert.equal(repaired.targetId, p2.id);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM db_relation_repairs WHERE action='repair'").get().n, 1);
  const doomed = repo.createRow(projects.id); repo.setCell(doomed.id, projectTitle.id, 'Temporal');
  repo.addRelation(t2.id, watchers.id, 'db_row', doomed.id);
  sqlite.prepare('DELETE FROM db_rows WHERE id = ?').run(doomed.id);
  assert.equal(repo.cleanupBrokenRelations(tasks.id).removed, 1);

  // Typed rollups over one relation cover text, counts, percentages, numeric and date families.
  const metrics = repo.createDatabase('Métricas');
  const metricTitle = repo.createColumn(metrics.id, 'Métrica', 'title');
  const amount = repo.createColumn(metrics.id, 'Valor', 'number');
  const due = repo.createColumn(metrics.id, 'Fecha', 'date');
  const checked = repo.createColumn(metrics.id, 'Hecho', 'checkbox');
  const metricRows = [repo.createRow(metrics.id), repo.createRow(metrics.id), repo.createRow(metrics.id)];
  for (const [index, row] of metricRows.entries()) {
    repo.setCell(row.id, metricTitle.id, ['Uno', 'Dos', 'Dos'][index]);
    repo.setCell(row.id, amount.id, ['10', '20', '40'][index]);
    repo.setCell(row.id, due.id, properties.encodeDatabaseDate({ start: [`2026-08-20`, `2026-08-18`, `2026-08-25`][index] }));
    repo.setCell(row.id, checked.id, index === 1 ? '0' : '1');
  }
  const summary = repo.createDatabase('Resumen');
  const summaryTitle = repo.createColumn(summary.id, 'Nombre', 'title');
  const metricsRelation = repo.createColumn(summary.id, 'Métricas', 'relation', {
    relationTargetKind: 'db_row', relationTargetDatabaseId: metrics.id, relationCardinality: 'many',
  });
  const summaryRow = repo.createRow(summary.id); repo.setCell(summaryRow.id, summaryTitle.id, 'Global');
  metricRows.forEach((row) => repo.addRelation(summaryRow.id, metricsRelation.id, 'db_row', row.id));
  const rollup = (name, target, fn) => repo.createColumn(summary.id, name, 'rollup', {
    rollupRelationColumnId: metricsRelation.id, rollupTargetColumnId: target.id, rollupFunction: fn,
  });
  const sum = rollup('Suma', amount, 'sum');
  const median = rollup('Mediana', amount, 'median');
  const unique = rollup('Únicos', metricTitle, 'show_unique');
  const earliest = rollup('Primera fecha', due, 'earliest_date');
  const range = rollup('Rango fechas', due, 'date_range');
  const percent = rollup('Completado', checked, 'percent_checked');
  const emptyPercent = rollup('Vacíos', amount, 'percent_empty');
  const hydratedSummary = repo.getRow(summaryRow.id);
  assert.equal(hydratedSummary.rollups[sum.id], '70');
  assert.equal(hydratedSummary.rollups[median.id], '20');
  assert.equal(hydratedSummary.rollups[unique.id], 'Uno, Dos');
  assert.equal(hydratedSummary.rollups[earliest.id], '2026-08-18');
  assert.equal(properties.decodeDatabaseDate(hydratedSummary.rollups[range.id]).end, '2026-08-25');
  assert.equal(hydratedSummary.rollups[percent.id], '67%', 'percentage presentation is retained');
  assert.equal(hydratedSummary.rollups[emptyPercent.id], '0%');
  assert.equal(domain.aggregateRollup('percent_checked', ['1', '0', '1']), '67%');
  assert.equal(domain.aggregateRollup('median', ['10', '20', '40']), '20');
  assert.equal(domain.aggregateRollup('show_unique', ['Uno', 'Dos', 'Dos']), 'Uno, Dos');
  const typedCells = new Map(sqlite.prepare(
    'SELECT column_id, value_type, value_number, value_date, value_json FROM db_computed_cells WHERE row_id = ?',
  ).all(summaryRow.id).map((cell) => [cell.column_id, cell]));
  assert.equal(typedCells.get(sum.id).value_type, 'number');
  assert.equal(typedCells.get(sum.id).value_number, 70);
  assert.equal(typedCells.get(earliest.id).value_type, 'date');
  assert.equal(typedCells.get(range.id).value_type, 'json');

  // Parser/evaluator: arithmetic, conditionals, text, dates, lists, people and relations.
  const expressionColumns = repo.getColumns(metrics.id);
  const expressionRow = repo.getRow(metricRows[0].id);
  const parsed = expressions.parseFormulaExpression(`if(property("${amount.id}") >= 10, upper("válido"), "no")`);
  assert.equal(expressions.evaluateFormulaExpression(parsed, { columns: new Map(expressionColumns.map((c) => [c.id, c])), row: expressionRow }), 'VÁLIDO');
  assert.equal(expressions.evaluateFormulaExpression(expressions.parseFormulaExpression('median(list(9, 1, 5))'), {
    columns: new Map(), row: expressionRow,
  }), 5);
  assert.match(expressions.evaluateFormulaExpression(expressions.parseFormulaExpression('dateAdd(date("2026-08-14"), 7, "days")'), {
    columns: new Map(), row: expressionRow,
  }), /^2026-08-21/);
  assert.throws(() => expressions.parseFormulaExpression('globalThis.process.exit()'), /Función no permitida|Símbolo no permitido/);
  assert.throws(() => expressions.parseFormulaExpression('property("x"); deleteAll()'), /Símbolo no permitido/);

  const relationFormulaSource = `sum(relation("${metricsRelation.id}", "${amount.id}"))`;
  const relationFormulaAst = expressions.parseFormulaExpression(relationFormulaSource);
  const relationFormula = repo.createColumn(summary.id, 'Total AST', 'formula', {
    formula: { kind: 'expression', source: relationFormulaSource, ast: relationFormulaAst, resultKind: 'number' },
  });
  assert.equal(repo.getRow(summaryRow.id).cells[relationFormula.id], '70');
  const unrelatedSource = 'concat("estable", "")';
  const unrelated = repo.createColumn(summary.id, 'No dependiente', 'formula', {
    formula: { kind: 'expression', source: unrelatedSource, ast: expressions.parseFormulaExpression(unrelatedSource), resultKind: 'text' },
  });
  const beforeUnrelatedRevision = sqlite.prepare('SELECT revision FROM db_computed_cells WHERE row_id=? AND column_id=?').get(summaryRow.id, unrelated.id).revision;
  repo.setCell(metricRows[0].id, amount.id, '15');
  assert.equal(repo.getRow(summaryRow.id).cells[relationFormula.id], '75', 'related target edit recalculates the dependent expression');
  assert.equal(sqlite.prepare('SELECT revision FROM db_computed_cells WHERE row_id=? AND column_id=?').get(summaryRow.id, unrelated.id).revision,
    beforeUnrelatedRevision, 'unrelated materialized formulas are not invalidated');

  const dateSource = 'dateAdd(date("2026-08-14"), 1, "days")';
  const dateFormula = repo.createColumn(summary.id, 'Mañana', 'formula', {
    formula: { kind: 'expression', source: dateSource, ast: expressions.parseFormulaExpression(dateSource), resultKind: 'date' },
  });
  const dateCell = sqlite.prepare('SELECT value_type, value_date FROM db_computed_cells WHERE row_id=? AND column_id=?').get(summaryRow.id, dateFormula.id);
  assert.equal(dateCell.value_type, 'date'); assert.match(dateCell.value_date, /^2026-08-15/);

  const visual = { kind: 'arithmetic', op: 'add', operands: [{ kind: 'number', value: 2 }, { kind: 'number', value: 3 }] };
  const compiled = formulas.formulaRecipeToExpression(visual);
  assert.equal(expressions.evaluateFormulaExpression(compiled, { columns: new Map(), row: expressionRow }), 5,
    'the visual recipe compiles to the shared AST');

  const formulaA = repo.createColumn(summary.id, 'A', 'formula', {
    formula: { kind: 'expression', source: '1', ast: expressions.parseFormulaExpression('1'), resultKind: 'number' },
  });
  const bSource = `property("${formulaA.id}")`;
  const formulaB = repo.createColumn(summary.id, 'B', 'formula', {
    formula: { kind: 'expression', source: bSource, ast: expressions.parseFormulaExpression(bSource), resultKind: 'number' },
  });
  const cycleSource = `property("${formulaB.id}")`;
  assert.throws(() => repo.updateColumn(formulaA.id, { config: { ...formulaA.config,
    formula: { kind: 'expression', source: cycleSource, ast: expressions.parseFormulaExpression(cycleSource), resultKind: 'number' } } }),
  /referencia circular/);
  assert.equal(repo.getColumn(formulaA.id).config.formula.source, '1', 'a rejected cycle never reaches SQLite');

  // Repository deletion removes inbound links and their inverse; no dangling pair survives.
  repo.deleteRow(p2.id);
  assert.equal(repo.listRelations(t1.id, taskProject.id).length, 0);
  assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
  assert.equal(sqlite.pragma('quick_check', { simple: true }), 'ok');
  sqlite.close();
  console.log('database relations, rollups and safe formula AST (real SQLite) test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const databaseStub = path.join(userDataPath, 'stub-database.cjs');
  fs.writeFileSync(databaseStub, 'exports.getDb = () => globalThis.__databaseRelationsFormulasDb;\n');
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
    if (resolved === path.join(repoRoot, 'electron/db/database.ts')) return databaseStub;
    return resolved;
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return {
      app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
      safeStorage: { isEncryptionAvailable: () => false }, BrowserWindow: class {}, dialog: {}, shell: {},
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}
