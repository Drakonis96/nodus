// Databases-mode store test. Runs under Electron-as-Node against a REAL migrated
// SQLite DB in a throwaway userData dir, exercising the pure helpers in
// shared/databases.ts and the CRUD/EAV/stats/cascade behaviour of databasesRepo.ts.

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

if (!process.argv.includes('--electron-databases-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-databases.mjs'), '--electron-databases-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-databases-test-'));
installRuntimeHooks(root);

try {
  const dbmode = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const databaseChatHistory = require(path.join(repoRoot, 'electron/db/databaseChatRepo.ts'));
  const shared = require(path.join(repoRoot, 'shared/databases.ts'));
  const csv = require(path.join(repoRoot, 'shared/databaseCsv.ts'));
  const aiShared = require(path.join(repoRoot, 'shared/databaseAi.ts'));
  const bulk = require(path.join(repoRoot, 'shared/databaseBulk.ts'));
  const filters = require(path.join(repoRoot, 'shared/databaseFilters.ts'));
  const profile = require(path.join(repoRoot, 'shared/dataProfile.ts'));
  const chart = require(path.join(repoRoot, 'shared/chartSpec.ts'));
  const exportShared = require(path.join(repoRoot, 'shared/databaseExport.ts'));
  const { exportDatabase, buildXlsx } = require(path.join(repoRoot, 'electron/export/databaseExport.ts'));
  const { generateAnalysisReport } = require(path.join(repoRoot, 'electron/ai/databaseAnalysis.ts'));
  const { buildDatabaseChatContext } = require(path.join(repoRoot, 'electron/ai/databaseChat.ts'));
  const { runAiCell, runAiColumn } = require(path.join(repoRoot, 'electron/ai/databaseAiColumn.ts'));
  const { runAiImageCell, runAiImageColumn } = require(path.join(repoRoot, 'electron/ai/databaseAiImageColumn.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  const version = getDb().pragma('user_version', { simple: true });
  assert.equal(version, SCHEMA_VERSION, `DB migrated to schema v${SCHEMA_VERSION}`);
  assert.ok(version >= 46, 'databases tables present (schema >= 46)');

  // ── Pure helpers (shared/databases.ts) ─────────────────────────────────────
  assert.equal(shared.newDatabaseShortId(() => 0), 'DB-AAAA', 'short id built from the alphabet');
  assert.match(shared.newDatabaseShortId(), /^DB-[A-Z0-9]{4}$/, 'short id shape');
  assert.equal(shared.entryPercent(1, 4), 25);
  assert.equal(shared.entryPercent(0, 0), 0, 'no divide-by-zero');
  assert.equal(shared.entryCountLabel(1240, 3351), '1,240 (37%)', 'locale count + percent');
  assert.equal(shared.encodeNumber(42), '42');
  assert.equal(shared.encodeNumber(Number.NaN), null);
  assert.equal(shared.decodeNumber('42.5'), 42.5);
  assert.equal(shared.decodeNumber(''), null);
  assert.equal(shared.encodeCheckbox(true), '1');
  assert.equal(shared.decodeCheckbox('1'), true);
  assert.equal(shared.decodeCheckbox('0'), false);
  assert.deepEqual(shared.decodeMultiSelect('["a","b"]'), ['a', 'b']);
  assert.equal(shared.encodeMultiSelect([]), null, 'empty multi-select stores NULL');
  assert.equal(shared.normalizeCellValue('number', 'abc'), null, 'invalid number normalizes to null');
  assert.equal(shared.normalizeCellValue('checkbox', 'true'), '1');
  assert.equal(shared.normalizeCellValue('text', ''), null, 'empty text normalizes to null');

  // ── Databases + unique short ids ───────────────────────────────────────────
  const db1 = dbmode.createDatabase('Fotos');
  const db2 = dbmode.createDatabase('Muestras');
  assert.match(db1.shortId, /^DB-[A-Z0-9]{4}$/);
  assert.notEqual(db1.shortId, db2.shortId, 'short ids are unique');
  assert.equal(db1.rowCount, 0);

  // ── Persisted database-chat history ────────────────────────────────────────
  const conversation = databaseChatHistory.createDatabaseChatConversation({ title: 'Comparar muestras', databaseIds: [db1.id, db2.id] });
  assert.deepEqual(conversation.databaseIds, [db1.id, db2.id]);
  assert.equal(conversation.messageCount, 0);
  const turns = [{ role: 'user', content: 'Compara' }, { role: 'assistant', content: 'Resultado' }];
  const savedConversation = databaseChatHistory.saveDatabaseChatConversation(conversation.id, turns, [db1.id]);
  assert.equal(savedConversation.messageCount, 2);
  assert.deepEqual(savedConversation.databaseIds, [db1.id]);
  assert.equal(databaseChatHistory.listDatabaseChatConversations()[0].id, conversation.id);
  databaseChatHistory.deleteDatabaseChatConversation(conversation.id);
  assert.equal(databaseChatHistory.getDatabaseChatConversation(conversation.id), null);
  assert.equal(dbmode.listDatabases().length, 2);

  // ── Columns + options ──────────────────────────────────────────────────────
  const title = dbmode.createColumn(db1.id, 'Nombre', 'title');
  const num = dbmode.createColumn(db1.id, 'Peso', 'number');
  const sel = dbmode.createColumn(db1.id, 'Estado', 'select');
  const multi = dbmode.createColumn(db1.id, 'Etiquetas', 'multi_select');
  const chk = dbmode.createColumn(db1.id, 'Revisado', 'checkbox');
  assert.equal(dbmode.getColumns(db1.id).length, 5);
  assert.equal(title.type, 'title');

  const optA = dbmode.addOption(sel.id, 'Nuevo', '#ef4444');
  dbmode.addOption(sel.id, 'Viejo', '#3b82f6');
  assert.equal(dbmode.getOptions(sel.id).length, 2);
  const tag1 = dbmode.addOption(multi.id, 'rojo');
  const tag2 = dbmode.addOption(multi.id, 'azul');

  // ── Rows + cells (EAV) ─────────────────────────────────────────────────────
  const r1 = dbmode.createRow(db1.id);
  dbmode.setCell(r1.id, title.id, 'Gato');
  dbmode.setCell(r1.id, num.id, '3.5');
  dbmode.setCell(r1.id, sel.id, optA.id);
  dbmode.setCell(r1.id, multi.id, shared.encodeMultiSelect([tag1.id, tag2.id]));
  dbmode.setCell(r1.id, chk.id, '1');
  const r2 = dbmode.createRow(db1.id);
  dbmode.setCell(r2.id, title.id, 'Perro');
  dbmode.setCell(r2.id, num.id, 'not-a-number'); // normalized → null → no cell written

  const rows = dbmode.listRows(db1.id, { sort: 'position' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cells[title.id], 'Gato');
  assert.equal(rows[0].cells[num.id], '3.5');
  assert.equal(rows[0].cells[sel.id], optA.id);
  assert.deepEqual(shared.decodeMultiSelect(rows[0].cells[multi.id]), [tag1.id, tag2.id]);
  assert.equal(rows[0].cells[chk.id], '1');
  assert.equal(rows[1].cells[num.id], undefined, 'an invalid number stored no cell');
  assert.equal(rows[1].cells[title.id], 'Perro');

  // Clearing a cell removes it (no stray empty strings).
  dbmode.setCell(r1.id, title.id, '');
  assert.equal(dbmode.getRow(r1.id).cells[title.id], undefined, 'empty value clears the cell');
  dbmode.setCell(r1.id, title.id, 'Gato');

  // ── Sidebar search: by title, and (opt-in) by cell content ─────────────────
  assert.deepEqual(dbmode.searchDatabases('', true), [], 'empty query returns nothing');
  const byTitle = dbmode.searchDatabases('foto', false);
  assert.equal(byTitle.length, 1, 'title search matches one database');
  assert.equal(byTitle[0].id, db1.id);
  assert.equal(byTitle[0].titleMatch, true);
  assert.equal(byTitle[0].contentMatches, 0, 'content not counted when the toggle is off');
  assert.equal(dbmode.searchDatabases('gato', false).length, 0, 'title-only search ignores cell content');
  const byContent = dbmode.searchDatabases('gato', true);
  assert.equal(byContent.length, 1, 'content search finds the database by a cell value');
  assert.equal(byContent[0].id, db1.id);
  assert.equal(byContent[0].titleMatch, false);
  assert.ok(byContent[0].contentMatches >= 1, 'reports at least one matching row');

  // Row-level search (dedicated search view): one hit per matching row, with a snippet.
  assert.deepEqual(dbmode.searchDatabaseRows(''), [], 'empty query returns no rows');
  const rowHits = dbmode.searchDatabaseRows('gato');
  assert.equal(rowHits.length, 1, 'finds the single row containing "gato"');
  assert.equal(rowHits[0].rowId, r1.id);
  assert.equal(rowHits[0].databaseId, db1.id);
  assert.equal(rowHits[0].title, 'Gato', 'resolves the row title');
  assert.ok(rowHits[0].snippet.toLowerCase().includes('gato'), 'snippet includes the match');
  assert.equal(dbmode.searchDatabaseRows('perro').length, 1, 'finds the other row by content');

  // Select / multi-select are matched by option LABEL (cells store ids, not labels).
  const bySelect = dbmode.searchDatabaseRows('nuevo');
  assert.equal(bySelect.length, 1, 'matches a row by its select option label');
  assert.equal(bySelect[0].rowId, r1.id);
  assert.ok(bySelect[0].snippet.toLowerCase().includes('nuevo'), 'select snippet shows the label');
  const byMulti = dbmode.searchDatabaseRows('rojo');
  assert.equal(byMulti.length, 1, 'matches a row by a multi-select option label');
  assert.ok(byMulti[0].snippet.toLowerCase().includes('rojo'), 'multi-select snippet shows labels');
  assert.ok(
    dbmode.searchDatabases('nuevo', true).some((h) => h.id === db1.id && h.contentMatches >= 1),
    'database content count includes option-label matches'
  );

  // ── Stats (count + % of vault total) ───────────────────────────────────────
  let s = dbmode.databaseStats(db1.id);
  assert.equal(s.rowCount, 2);
  assert.equal(s.vaultTotal, 2);
  assert.equal(s.percent, 100);
  dbmode.createRow(db2.id);
  s = dbmode.databaseStats(db1.id);
  assert.equal(s.vaultTotal, 3, 'vault total spans every database');
  assert.equal(s.percent, 67, '2 of 3 rows rounds to 67%');

  // ── Deleting an option purges it from cells ────────────────────────────────
  dbmode.deleteOption(optA.id);
  assert.equal(dbmode.getRow(r1.id).cells[sel.id], undefined, 'select cell cleared when its option is deleted');
  dbmode.deleteOption(tag1.id);
  assert.deepEqual(
    shared.decodeMultiSelect(dbmode.getRow(r1.id).cells[multi.id]),
    [tag2.id],
    'deleted option removed from a multi-select cell'
  );

  // ── Rename + column delete cascade + reorder ───────────────────────────────
  assert.equal(dbmode.renameDatabase(db1.id, 'Fotos 2').name, 'Fotos 2');
  dbmode.deleteColumn(num.id);
  assert.equal(dbmode.getRow(r1.id).cells[num.id], undefined, 'cells cascade when a column is deleted');
  assert.equal(dbmode.getColumns(db1.id).length, 4);
  const colIds = dbmode.getColumns(db1.id).map((c) => c.id);
  dbmode.reorderColumns(db1.id, [...colIds].reverse());
  assert.deepEqual(dbmode.getColumns(db1.id).map((c) => c.id), [...colIds].reverse(), 'columns reordered');

  // ── Attachments (phase 2): BLOB in SQLite, listed with rows, cascade on delete ──
  const photoCol = dbmode.createColumn(db1.id, 'Foto', 'attachment');
  const rAtt = dbmode.createRow(db1.id);
  const att = dbmode.addAttachment({
    rowId: rAtt.id,
    columnId: photoCol.id,
    fileName: 'x.png',
    mimeType: 'image/png',
    bytes: 3,
    blob: Buffer.from('PNG'),
    contentHash: 'hash1',
    extractedText: null,
  });
  assert.ok(att.id && att.hasBlob === true, 'attachment stored with a blob');
  assert.equal(dbmode.listAttachments(rAtt.id, photoCol.id).length, 1);
  assert.equal(dbmode.getAttachmentBlob(att.id).toString(), 'PNG', 'blob fetched on demand');
  assert.equal(dbmode.attachmentExists(rAtt.id, photoCol.id, 'hash1'), true, 'dedupe check by hash');
  const withAtt = dbmode.listRows(db1.id, { sort: 'position' }).find((r) => r.id === rAtt.id);
  assert.equal(withAtt.attachments[photoCol.id].length, 1, 'listRows carries attachment metadata');
  dbmode.deleteAttachment(att.id);
  assert.equal(dbmode.listAttachments(rAtt.id, photoCol.id).length, 0, 'attachment deleted');
  // Cascade: deleting the column removes its attachments.
  const att2 = dbmode.addAttachment({ rowId: rAtt.id, columnId: photoCol.id, fileName: 'y.png', mimeType: 'image/png', bytes: 3, blob: Buffer.from('PNG') });
  dbmode.deleteColumn(photoCol.id);
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS c FROM db_attachments WHERE id = ?').get(att2.id).c,
    0,
    'attachments cascade when the column is deleted'
  );

  // ── Detail + cascade delete of the whole database ──────────────────────────
  const detail = dbmode.getDatabaseDetail(db1.id);
  assert.ok(detail && detail.columns.length === 4, 'detail carries columns');
  dbmode.deleteDatabase(db1.id);
  assert.equal(dbmode.getDatabase(db1.id), null);
  assert.equal(dbmode.listRows(db1.id).length, 0);
  const remainingCells = getDb().prepare('SELECT COUNT(*) AS c FROM db_cells').get().c;
  assert.equal(remainingCells, 0, 'cells cascade-deleted with the database (db2 row has no cells)');
  assert.equal(dbmode.listDatabases().length, 1, 'db2 survives');

  // ── CSV inference (shared/databaseCsv, pure) ───────────────────────────────
  assert.equal(csv.inferColumnType(['1', '2', '3']), 'number');
  assert.equal(csv.inferColumnType(['2020-01-01', '2021-05-05']), 'date');
  assert.equal(csv.inferColumnType(['sí', 'no', 'sí']), 'checkbox');
  assert.equal(csv.inferColumnType(['A', 'B', 'A', 'B']), 'select');
  assert.equal(csv.inferColumnType(['una frase larga', 'otra frase distinta', 'y una tercera']), 'text');
  const plan = csv.buildCsvImportPlan([
    ['Nombre', 'Peso', 'Estado'],
    ['Gato', '3.5', 'vivo'],
    ['Perro', '8', 'vivo'],
  ]);
  assert.deepEqual(plan.headers, ['Nombre', 'Peso', 'Estado']);
  assert.equal(plan.rows.length, 2);
  assert.equal(plan.suggestedTypes[0], 'title');
  assert.equal(plan.suggestedTypes[1], 'number');
  assert.deepEqual(csv.splitMultiValue('a, b; c'), ['a', 'b', 'c']);
  assert.equal(csv.normalizeCsvValue('number', '3,5'), '3.5');
  assert.equal(csv.normalizeCsvValue('checkbox', 'sí'), '1');

  // ── createDatabaseFromCsv (repo): options built from distinct values ────────
  const imported = dbmode.createDatabaseFromCsv(
    'Importada',
    ['Nombre', 'Peso', 'Estado'],
    [
      ['Gato', '3.5', 'vivo'],
      ['Perro', '8', 'muerto'],
      ['Loro', '1.2', 'vivo'],
    ],
    ['title', 'number', 'select']
  );
  const impDetail = dbmode.getDatabaseDetail(imported.id);
  assert.equal(impDetail.columns.length, 3);
  assert.equal(impDetail.columns[2].type, 'select');
  assert.equal(impDetail.columns[2].options.length, 2, 'select options built from distinct CSV values');
  const impRows = dbmode.listRows(imported.id, { sort: 'position' });
  assert.equal(impRows.length, 3);
  assert.equal(impRows[0].cells[impDetail.columns[0].id], 'Gato');
  assert.equal(impRows[0].cells[impDetail.columns[1].id], '3.5');
  const vivoOpt = impDetail.columns[2].options.find((o) => o.label === 'vivo');
  assert.equal(impRows[0].cells[impDetail.columns[2].id], vivoOpt.id, 'select cell maps to the option id');

  // ── AI columns: pure context + injected completion persistence ─────────────
  const aiDb = dbmode.createDatabase('IA');
  const aiTitle = dbmode.createColumn(aiDb.id, 'Nombre', 'title');
  const aiNum = dbmode.createColumn(aiDb.id, 'Peso', 'number');
  const aiCol = dbmode.createColumn(aiDb.id, 'Resumen', 'ai', { aiPrompt: 'Resume la fila.' });
  const aiRow = dbmode.createRow(aiDb.id);
  dbmode.setCell(aiRow.id, aiTitle.id, 'Musgo');
  dbmode.setCell(aiRow.id, aiNum.id, '12');
  const ctx = aiShared.buildAiRowContext(dbmode.getColumns(aiDb.id), dbmode.getRow(aiRow.id), { excludeColumnId: aiCol.id });
  assert.match(ctx, /Nombre: Musgo/);
  assert.match(ctx, /Peso: 12/);
  assert.ok(!ctx.includes('Resumen'), 'the AI column is excluded from its own context');
  const produced = await runAiCell(aiRow.id, aiCol.id, {
    complete: async (opts) => `RESUMEN: ${opts.user.includes('Musgo') ? 'ok' : 'no'}`,
  });
  assert.equal(produced, 'RESUMEN: ok');
  assert.equal(dbmode.getRow(aiRow.id).cells[aiCol.id], 'RESUMEN: ok', 'AI result persisted to the cell');
  // Batch: runAiColumn fills every row.
  const aiRow2 = dbmode.createRow(aiDb.id);
  dbmode.setCell(aiRow2.id, aiTitle.id, 'Liquen');
  const batch = await runAiColumn(aiDb.id, aiCol.id, undefined, { complete: async () => 'X' });
  assert.equal(batch.done, 2, 'batch ran over both rows');
  assert.equal(dbmode.getRow(aiRow2.id).cells[aiCol.id], 'X', 'batch AI filled the new row');

  // ── AI image columns: generate → stored as an AI-flagged attachment ─────────
  const imgDb = dbmode.createDatabase('Retratos');
  const imgTitle = dbmode.createColumn(imgDb.id, 'Nombre', 'title');
  const imgCol = dbmode.createColumn(imgDb.id, 'Retrato', 'ai_image', { aiPrompt: 'Retrato ilustrado de {Nombre}.' });
  const imgRow = dbmode.createRow(imgDb.id);
  dbmode.setCell(imgRow.id, imgTitle.id, 'Ada');
  let seenPrompt = '';
  const genAtt = await runAiImageCell(imgRow.id, imgCol.id, {
    generate: async (prompt) => {
      seenPrompt = prompt;
      return { image: Buffer.from('JPEGBYTES'), mimeType: 'image/jpeg' };
    },
  });
  assert.match(seenPrompt, /Retrato ilustrado/, 'image prompt carries the column instruction');
  assert.match(seenPrompt, /Ada/, 'image prompt is enriched with the row context');
  assert.equal(genAtt.aiGenerated, true, 'generated attachment flagged aiGenerated');
  assert.equal(genAtt.aiPrompt, seenPrompt, 'the exact prompt is stored on the attachment');
  assert.equal(genAtt.mimeType, 'image/jpeg');
  const imgAtts = dbmode.listAttachments(imgRow.id, imgCol.id);
  assert.equal(imgAtts.length, 1, 'one image attached to the cell');
  assert.equal(dbmode.getAttachmentBlob(imgAtts[0].id).toString(), 'JPEGBYTES', 'image blob stored');
  // Regenerating replaces the previous image (a cell holds one current AI image).
  await runAiImageCell(imgRow.id, imgCol.id, { generate: async () => ({ image: Buffer.from('NEW'), mimeType: 'image/jpeg' }) });
  const after = dbmode.listAttachments(imgRow.id, imgCol.id);
  assert.equal(after.length, 1, 'regeneration replaces rather than appends');
  assert.equal(dbmode.getAttachmentBlob(after[0].id).toString(), 'NEW', 'regenerated blob replaced the old one');
  // Batch over the whole column.
  const imgRow2 = dbmode.createRow(imgDb.id);
  dbmode.setCell(imgRow2.id, imgTitle.id, 'Grace');
  const imgBatch = await runAiImageColumn(imgDb.id, imgCol.id, undefined, {
    generate: async () => ({ image: Buffer.from('B'), mimeType: 'image/jpeg' }),
  });
  assert.equal(imgBatch.done, 2, 'batch ran over both rows');
  assert.equal(dbmode.listAttachments(imgRow2.id, imgCol.id).length, 1, 'batch generated the new row image');

  // updateOption: rename + recolor a select option.
  const estadoCol = impDetail.columns[2];
  const anOpt = estadoCol.options[0];
  dbmode.updateOption(anOpt.id, { label: 'REVISADO', color: '#123456' });
  const reOpt = dbmode.getColumns(imported.id).find((c) => c.id === estadoCol.id).options.find((o) => o.id === anOpt.id);
  assert.equal(reOpt.label, 'REVISADO', 'option label updated');
  assert.equal(reOpt.color, '#123456', 'option colour updated');

  // ── Relations (repo): add/list/idempotent/search/remove/cascade ────────────
  const relDb = dbmode.createDatabase('Relaciones');
  const relCol = dbmode.createColumn(relDb.id, 'Vínculo', 'relation', {
    relationTargetKind: 'db_row',
    relationTargetDatabaseId: imported.id,
  });
  const relRow = dbmode.createRow(relDb.id);
  const rel = dbmode.addRelation(relRow.id, relCol.id, 'db_row', impRows[0].id);
  assert.equal(rel.label, 'Gato', 'relation resolves the target row title');
  assert.equal(dbmode.listRelations(relRow.id, relCol.id).length, 1);
  dbmode.addRelation(relRow.id, relCol.id, 'db_row', impRows[0].id);
  assert.equal(dbmode.listRelations(relRow.id, relCol.id).length, 1, 'adding the same relation is idempotent');
  const candidates = dbmode.searchRelationTargets('db_row', 'Perro', { databaseId: imported.id });
  assert.ok(candidates.some((c) => c.label === 'Perro'), 'relation target search finds rows by title');
  // Relation counts load into rows → filtering + profile work for relation columns.
  const relRows = dbmode.listRows(relDb.id, { sort: 'position' });
  const relCols = dbmode.getColumns(relDb.id);
  assert.equal(relRows.find((r) => r.id === relRow.id).relationCounts[relCol.id], 1, 'relation count loaded into row');
  assert.equal(
    filters.applyDatabaseFilter(relRows, relCols, { conjunction: 'and', conditions: [{ id: 'c', columnId: relCol.id, op: 'notEmpty' }] }).length,
    1,
    'relation notEmpty filter'
  );
  assert.equal(
    filters.applyDatabaseFilter(relRows, relCols, { conjunction: 'and', conditions: [{ id: 'c', columnId: relCol.id, op: 'isEmpty' }] }).length,
    0,
    'relation isEmpty filter'
  );
  const relProfileCol = profile.computeProfile(relCols, relRows).columns.find((c) => c.type === 'relation');
  assert.equal(relProfileCol.relationLinks, 1, 'relation profile counts links');
  dbmode.removeRelation(rel.id);
  assert.equal(dbmode.listRelations(relRow.id, relCol.id).length, 0);
  const rel2 = dbmode.addRelation(relRow.id, relCol.id, 'db_row', impRows[1].id);
  dbmode.deleteRow(relRow.id);
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS c FROM db_relations WHERE id = ?').get(rel2.id).c,
    0,
    'relations cascade when the row is deleted'
  );

  // ── Rollup aggregation (shared, pure) ──────────────────────────────────────
  assert.equal(shared.aggregateRollup('sum', ['10', '5', null, '2']), '17');
  assert.equal(shared.aggregateRollup('average', ['10', '20']), '15');
  assert.equal(shared.aggregateRollup('count', ['a', null, 'b']), '3', 'count includes empties');
  assert.equal(shared.aggregateRollup('count_values', ['a', null, 'b']), '2', 'count_values skips empties');
  assert.equal(shared.aggregateRollup('count_unique', ['a', 'a', 'b']), '2');
  assert.equal(shared.aggregateRollup('max', ['3', '9', '1']), '9');
  assert.equal(shared.aggregateRollup('range', ['3', '9', '1']), '8');
  assert.equal(shared.aggregateRollup('percent_checked', ['1', '0', '1', '0']), '50%');
  assert.equal(shared.aggregateRollup('show', ['Ana', null, 'Bea']), 'Ana, Bea');

  // ── Rollup column computed across a relation to another database ────────────
  const ruOrdDb = dbmode.createDatabase('Pedidos');
  const ruOrdTitle = dbmode.createColumn(ruOrdDb.id, 'Ref', 'title');
  const ruOrdAmount = dbmode.createColumn(ruOrdDb.id, 'Importe', 'number');
  const ruOrd1 = dbmode.createRow(ruOrdDb.id);
  dbmode.setCell(ruOrd1.id, ruOrdTitle.id, 'A');
  dbmode.setCell(ruOrd1.id, ruOrdAmount.id, '10');
  const ruOrd2 = dbmode.createRow(ruOrdDb.id);
  dbmode.setCell(ruOrd2.id, ruOrdTitle.id, 'B');
  dbmode.setCell(ruOrd2.id, ruOrdAmount.id, '5');
  const ruCliDb = dbmode.createDatabase('Clientes');
  const ruCliName = dbmode.createColumn(ruCliDb.id, 'Nombre', 'title');
  const ruRel = dbmode.createColumn(ruCliDb.id, 'Pedidos', 'relation', { relationTargetKind: 'db_row', relationTargetDatabaseId: ruOrdDb.id });
  const ruSum = dbmode.createColumn(ruCliDb.id, 'Total', 'rollup', { rollupRelationColumnId: ruRel.id, rollupTargetColumnId: ruOrdAmount.id, rollupFunction: 'sum' });
  const ruCount = dbmode.createColumn(ruCliDb.id, 'NumPedidos', 'rollup', { rollupRelationColumnId: ruRel.id, rollupTargetColumnId: '__title__', rollupFunction: 'count' });
  const ruCli1 = dbmode.createRow(ruCliDb.id);
  dbmode.setCell(ruCli1.id, ruCliName.id, 'Cliente 1');
  dbmode.addRelation(ruCli1.id, ruRel.id, 'db_row', ruOrd1.id);
  dbmode.addRelation(ruCli1.id, ruRel.id, 'db_row', ruOrd2.id);
  const ruCliRow = dbmode.listRows(ruCliDb.id, { sort: 'position' }).find((r) => r.id === ruCli1.id);
  assert.equal(ruCliRow.rollups[ruSum.id], '15', 'rollup sums the related Importe (10+5)');
  assert.equal(ruCliRow.rollups[ruCount.id], '2', 'rollup counts the related rows');
  assert.equal(dbmode.getRow(ruCli1.id).rollups[ruSum.id], '15', 'getRow also computes rollups');

  // ── Cross-vault entity relation kind (gap) — resolve + search ──────────────
  getDb().prepare("INSERT INTO gaps (id, statement) VALUES ('g1', 'Falta evidencia sobre X')").run();
  const ruGapRel = dbmode.createColumn(ruCliDb.id, 'Vacío', 'relation', { relationTargetKind: 'gap' });
  const ruGapLink = dbmode.addRelation(ruCli1.id, ruGapRel.id, 'gap', 'g1', null);
  assert.equal(ruGapLink.targetKind, 'gap');
  assert.equal(ruGapLink.label, 'Falta evidencia sobre X', 'gap relation resolves its statement as the label');
  assert.equal(ruGapLink.broken, false, 'a resolvable gap link is not broken');
  const ruGapHits = dbmode.searchRelationTargets('gap', 'evidencia');
  assert.ok(ruGapHits.some((h) => h.id === 'g1'), 'gap relation search finds the gap by its statement');

  // ── Bulk file matching (shared/databaseBulk, pure) ─────────────────────────
  assert.equal(bulk.fileMatchKey('Foto_01.PNG'), 'foto_01');
  const bm = bulk.matchFilesToRows(
    ['gato.png', 'perro.jpg', 'nope.png'],
    [
      { rowId: 'r1', refValue: 'Gato' },
      { rowId: 'r2', refValue: 'Perro' },
    ]
  );
  assert.equal(bm.find((m) => m.fileName === 'gato.png').rowId, 'r1', 'file matches a row by name without extension');
  assert.equal(bm.find((m) => m.fileName === 'nope.png').rowId, null, 'unmatched file has no row');
  assert.deepEqual(bulk.countMatches(bm), { matched: 2, unmatched: 1 });

  // ── Filters + sorts (shared/databaseFilters) over a real database ──────────
  const fDb = dbmode.createDatabase('Filtros');
  const cName = dbmode.createColumn(fDb.id, 'Nombre', 'title');
  const cNum = dbmode.createColumn(fDb.id, 'Peso', 'number');
  const cSel = dbmode.createColumn(fDb.id, 'Estado', 'select');
  const cChk = dbmode.createColumn(fDb.id, 'Ok', 'checkbox');
  const oA = dbmode.addOption(cSel.id, 'A');
  const oB = dbmode.addOption(cSel.id, 'B');
  const mk = (name, peso, sel, ok) => {
    const r = dbmode.createRow(fDb.id);
    dbmode.setCell(r.id, cName.id, name);
    dbmode.setCell(r.id, cNum.id, peso);
    if (sel) dbmode.setCell(r.id, cSel.id, sel);
    dbmode.setCell(r.id, cChk.id, ok ? '1' : '0');
    return r;
  };
  mk('Alfa', '10', oA.id, true);
  mk('Beta', '5', oB.id, false);
  mk('Gamma', '20', oA.id, true);
  const fcols = dbmode.getColumns(fDb.id);
  const frows = dbmode.listRows(fDb.id, { sort: 'position' });
  assert.equal(
    filters.applyDatabaseFilter(frows, fcols, { conjunction: 'and', conditions: [{ id: 'c', columnId: cNum.id, op: 'gt', value: '8' }] }).length,
    2,
    'number > 8 filters to two rows'
  );
  assert.equal(
    filters.applyDatabaseFilter(frows, fcols, { conjunction: 'and', conditions: [{ id: 'c', columnId: cSel.id, op: 'isAnyOf', value: [oA.id] }] }).length,
    2,
    'select isAnyOf'
  );
  assert.equal(
    filters.applyDatabaseFilter(frows, fcols, { conjunction: 'and', conditions: [{ id: 'c', columnId: cChk.id, op: 'isChecked' }] }).length,
    2,
    'checkbox isChecked'
  );
  assert.equal(
    filters.applyDatabaseFilter(frows, fcols, {
      conjunction: 'or',
      conditions: [
        { id: 'a', columnId: cNum.id, op: 'lt', value: '8' },
        { id: 'b', columnId: cSel.id, op: 'isAnyOf', value: [oA.id] },
      ],
    }).length,
    3,
    'OR across conditions'
  );
  assert.deepEqual(
    filters.sortDatabaseRows(frows, fcols, [{ columnId: cNum.id, dir: 'desc' }]).map((r) => r.cells[cNum.id]),
    ['20', '10', '5'],
    'numeric sort desc'
  );
  assert.ok(filters.operatorsForType('number').includes('gt'));
  assert.deepEqual(filters.operatorsForType('relation'), ['isEmpty', 'notEmpty'], 'relation columns filter by empty/not-empty');
  // Nested groups: a group (select=B OR number<8) → only Beta matches.
  assert.equal(
    filters.applyDatabaseFilter(frows, fcols, {
      conjunction: 'and',
      conditions: [],
      groups: [
        {
          id: 'g1',
          conjunction: 'or',
          conditions: [
            { id: 'a', columnId: cSel.id, op: 'isAnyOf', value: [oB.id] },
            { id: 'b', columnId: cNum.id, op: 'lt', value: '8' },
          ],
        },
      ],
    }).length,
    1,
    'nested group with OR'
  );
  // A top-level condition AND a group: (number>8) AND (select is A) → Alfa + Gamma.
  assert.equal(
    filters.applyDatabaseFilter(frows, fcols, {
      conjunction: 'and',
      conditions: [{ id: 'c', columnId: cNum.id, op: 'gt', value: '8' }],
      groups: [{ id: 'g2', conjunction: 'and', conditions: [{ id: 'd', columnId: cSel.id, op: 'isAnyOf', value: [oA.id] }] }],
    }).length,
    2,
    'top-level condition AND a group'
  );
  assert.equal(
    filters.isFilterActive({ conjunction: 'and', conditions: [], groups: [{ id: 'g', conjunction: 'and', conditions: [{ id: 'x', columnId: cNum.id, op: 'gt', value: '0' }] }] }),
    true,
    'a non-empty group makes the filter active'
  );

  // ── Saved views (repo): CRUD + cascade ─────────────────────────────────────
  const vView = dbmode.createView(fDb.id, {
    name: 'Pesados',
    layout: 'gallery',
    filter: { conjunction: 'and', conditions: [{ id: 'c', columnId: cNum.id, op: 'gt', value: '8' }] },
    sorts: [{ columnId: cNum.id, dir: 'desc' }],
  });
  assert.equal(vView.layout, 'gallery');
  assert.equal(vView.filter.conditions.length, 1, 'view persists its filter');
  assert.equal(vView.sorts.length, 1, 'view persists its sort');
  assert.equal(dbmode.listViews(fDb.id).length, 1);
  const upd = dbmode.updateView(vView.id, { name: 'Pesados 2', sorts: [] });
  assert.equal(upd.name, 'Pesados 2');
  assert.equal(upd.sorts.length, 0, 'view sort cleared on update');
  dbmode.deleteView(vView.id);
  assert.equal(dbmode.listViews(fDb.id).length, 0);
  const v2 = dbmode.createView(fDb.id, { name: 'X', layout: 'table', filter: { conjunction: 'and', conditions: [] }, sorts: [] });
  dbmode.deleteDatabase(fDb.id);
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS c FROM db_views WHERE id = ?').get(v2.id).c,
    0,
    'views cascade when the database is deleted'
  );

  // ── Data profile + AI report (Phase 6) ─────────────────────────────────────
  const pDb = dbmode.createDatabase('Perfil');
  const pName = dbmode.createColumn(pDb.id, 'Nombre', 'title');
  const pNum = dbmode.createColumn(pDb.id, 'Valor', 'number');
  const pSel = dbmode.createColumn(pDb.id, 'Cat', 'select');
  const pChk = dbmode.createColumn(pDb.id, 'Ok', 'checkbox');
  const cX = dbmode.addOption(pSel.id, 'X');
  const cY = dbmode.addOption(pSel.id, 'Y');
  const pr = (nm, val, cat, ok) => {
    const r = dbmode.createRow(pDb.id);
    dbmode.setCell(r.id, pName.id, nm);
    dbmode.setCell(r.id, pNum.id, val);
    if (cat) dbmode.setCell(r.id, pSel.id, cat);
    dbmode.setCell(r.id, pChk.id, ok ? '1' : '0');
  };
  pr('a', '10', cX.id, true);
  pr('b', '20', cX.id, false);
  pr('c', '30', cY.id, true);
  const prof = profile.computeProfile(dbmode.getColumns(pDb.id), dbmode.listRows(pDb.id));
  assert.equal(prof.rowCount, 3);
  const numProf = prof.columns.find((c) => c.type === 'number');
  assert.equal(numProf.number.mean, 20, 'mean');
  assert.equal(numProf.number.median, 20, 'median');
  assert.equal(numProf.number.min, 10);
  assert.equal(numProf.number.max, 30);
  assert.ok(numProf.number.histogram.length >= 1, 'histogram computed');
  const selProf = prof.columns.find((c) => c.type === 'select');
  assert.equal(selProf.distribution.find((d) => d.label === 'X').count, 2, 'select distribution');
  const chkProf = prof.columns.find((c) => c.type === 'checkbox');
  assert.equal(chkProf.checkbox.checked, 2, 'checkbox split');
  const txt = profile.profileToText('Perfil', prof);
  assert.match(txt, /media 20/, 'profile text carries the figures');
  const rep = await generateAnalysisReport(pDb.id, {
    complete: async (opts) => `Informe: ${opts.user.includes('media 20') ? 'ok' : 'no'}`,
  });
  assert.equal(rep.report, 'Informe: ok', 'report written over the profile');
  assert.match(rep.profileText, /Filas: 3/, 'report exposes the data it used');

  // ── Chat: chart-spec parsing + context builder (Phase 7) ───────────────────
  const segs = chart.parseChatSegments('Antes.\n```chart\n{"type":"bar","items":[{"label":"A","value":3}]}\n```\nDespués.');
  assert.equal(segs.length, 3, 'segments: md + chart + md');
  assert.equal(segs[0].kind, 'md');
  assert.equal(segs[1].kind, 'chart');
  assert.equal(segs[1].spec.items[0].value, 3);
  assert.equal(segs[2].kind, 'md');
  assert.equal(chart.isChartSpec({ type: 'pie', items: [{ label: 'x', value: 1 }] }), true);
  assert.equal(chart.isChartSpec({ type: 'bad', items: [] }), false, 'invalid chart type rejected');
  const chatCtx = buildDatabaseChatContext([pDb.id]);
  assert.match(chatCtx.context, /BASE DE DATOS: Perfil/, 'chat context names the database');
  assert.match(chatCtx.context, /media 20/, 'chat context includes the profile');
  assert.match(chatCtx.context, /Muestra de filas/, 'chat context includes a row sample');
  assert.ok(chatCtx.names.includes('Perfil'));

  // ── Export CSV / JSON / XLSX (Phase 8) ─────────────────────────────────────
  const expCols = dbmode.getColumns(imported.id);
  const expRows = dbmode.listRows(imported.id, { sort: 'position' });
  const csvOut = exportShared.databaseToCsv(expCols, expRows);
  assert.match(csvOut.split('\r\n')[0], /^Nombre,Peso,Estado$/, 'CSV header from column names');
  assert.match(csvOut, /Gato,3\.5,/, 'CSV row with the number value');
  const parsedJson = JSON.parse(exportShared.databaseToJson(expCols, expRows));
  assert.equal(parsedJson.rows.length, 3);
  assert.equal(parsedJson.rows[0].Peso, 3.5, 'JSON keeps numbers typed');
  const xlsx = buildXlsx(['A', 'B'], [[{ text: 'x', numeric: null }, { text: '', numeric: 5 }]]);
  assert.ok(Buffer.isBuffer(xlsx) && xlsx.slice(0, 2).toString() === 'PK', 'XLSX is a valid zip package');
  const exp = exportDatabase(imported.id, 'csv');
  assert.equal(exp.fileName, 'Importada.csv');
  assert.equal(exp.content[0], 0xef, 'CSV export starts with a UTF-8 BOM');

  const chatView = fs.readFileSync(path.join(repoRoot, 'src/views/DatabasesChatView.tsx'), 'utf8');
  assert.match(chatView, /database-chat-history-toggle/);
  assert.match(chatView, /database-chat-history-sidebar/);
  assert.match(chatView, /listDatabaseChatConversations/);
  assert.match(chatView, /saveDatabaseChatConversation/);
  assert.match(chatView, /<ConfirmModal/);
  const preloadSource = fs.readFileSync(path.join(repoRoot, 'electron/preload.ts'), 'utf8');
  const ipcSource = fs.readFileSync(path.join(repoRoot, 'electron/ipc.ts'), 'utf8');
  assert.match(preloadSource, /db:chatHistory:list/);
  assert.match(ipcSource, /db:chatHistory:delete/);
  console.log('Databases mode test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-test',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (v) => Buffer.from(String(v), 'utf8'),
      decryptString: (v) => Buffer.from(v).toString('utf8'),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
