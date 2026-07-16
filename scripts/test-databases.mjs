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
  const formulaShared = require(path.join(repoRoot, 'shared/databaseFormula.ts'));
  const formulaEval = require(path.join(repoRoot, 'shared/databaseFormulaEval.ts'));
  const profile = require(path.join(repoRoot, 'shared/dataProfile.ts'));
  const chart = require(path.join(repoRoot, 'shared/chartSpec.ts'));
  const exportShared = require(path.join(repoRoot, 'shared/databaseExport.ts'));
  const { exportDatabase, buildXlsx } = require(path.join(repoRoot, 'electron/export/databaseExport.ts'));
  const { generateAnalysisReport } = require(path.join(repoRoot, 'electron/ai/databaseAnalysis.ts'));
  const { buildDatabaseChatContext } = require(path.join(repoRoot, 'electron/ai/databaseChat.ts'));
  const chatShared = require(path.join(repoRoot, 'shared/databaseChat.ts'));
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
  assert.equal(csv.normalizeCsvValue('date', '13/05/2020'), null, 'a non-ISO date has nowhere to go');
  assert.equal(csv.normalizeCsvValue('date', '2020-05-13'), '2020-05-13');

  // ── Column suggestions: null markers, headers, tag lists ───────────────────
  // A "no data" placeholder must not drag a numeric column down to text: real sheets
  // write s.d. / - for unknown, and one of them among 7k years is not evidence of prose.
  assert.ok(csv.isNullMarker('s.d.') && csv.isNullMarker('-') && !csv.isNullMarker('1958'));
  assert.equal(csv.suggestColumn('Fecha', ['1958', '1960', 's.d.', '1962'], 1).type, 'number');
  assert.equal(csv.suggestColumn('Lugar', ['Ronda', '-', 'Sevilla', 'Ronda'], 1).type, 'select');
  // A short vocabulary repeated across many rows is a select even past the 12-option mark.
  const regions = Array.from({ length: 300 }, (_, i) => `Region ${i % 18}`);
  assert.equal(csv.suggestColumn('Comunidad', regions, 1).type, 'select');
  // ...but hundreds of distinct values are not a controlled vocabulary.
  assert.equal(csv.suggestColumn('Lugar', Array.from({ length: 300 }, (_, i) => `Pueblo ${i}`), 1).type, 'text');
  // Tag lists reuse a small vocabulary; comma-laden prose does not.
  const tagRows = Array.from({ length: 30 }, () => 'arquitectura civil, paisaje urbano, fiestas');
  assert.equal(csv.suggestColumn('Etiquetas', tagRows, 1).type, 'multi_select');
  const prose = Array.from({ length: 30 }, (_, i) => `La imagen muestra una escena ${i}, con detalles variados, y un fondo distinto ${i}`);
  assert.equal(csv.suggestColumn('Descripcion visual', prose, 1).type, 'text');
  // Header hints: a numeric-looking id is not a quantity; an empty file column is a target.
  assert.equal(csv.suggestColumn('Codigo', ['001', '002', '003'], 1).type, 'text');
  assert.equal(csv.suggestColumn('Peso', ['001', '002', '003'], 1).type, 'number');
  assert.equal(csv.suggestColumn('Documento', ['', '', ''], 1).type, 'attachment');
  assert.equal(csv.suggestColumn('Nada', ['', '', ''], 1).type, 'text');
  assert.equal(csv.suggestColumn('Lo que sea', ['x'], 0).type, 'title', 'first column identifies the row');
  const dropped = csv.suggestColumn('Peso', ['1', '2', 'tres'], 1);
  assert.equal(dropped.type, 'text', 'one non-numeric value is not a null marker');
  assert.equal(csv.suggestColumn('Fecha', ['1958', 's.d.'], 1).filled, 1, 'null markers are not counted as values');
  // Blob/table-backed types cannot receive an imported string.
  assert.ok(csv.typeStoresImportedText('text') && csv.typeStoresImportedText('ai'));
  assert.ok(!csv.typeStoresImportedText('attachment') && !csv.typeStoresImportedText('relation'));
  assert.ok(!csv.typeStoresImportedText('ai_image') && !csv.typeStoresImportedText('rollup'));

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

  // Discarding columns (type = null) must not shift the remaining cells' mapping, and a
  // blob-backed type gets its column but no imported text.
  const partial = dbmode.createDatabaseFromCsv(
    'Parcial',
    ['Nombre', 'Basura', 'Peso', 'Foto'],
    [
      ['Gato', 'xxx', '3.5', 'gato.jpg'],
      ['Perro', 'yyy', '8', 'perro.jpg'],
    ],
    ['title', null, 'number', 'attachment']
  );
  const partialDetail = dbmode.getDatabaseDetail(partial.id);
  assert.deepEqual(partialDetail.columns.map((c) => c.name), ['Nombre', 'Peso', 'Foto'], 'discarded column is not created');
  const partialRows = dbmode.listRows(partial.id, { sort: 'position' });
  assert.equal(partialRows[0].cells[partialDetail.columns[1].id], '3.5', 'cells still line up after a discard');
  assert.equal(partialRows[0].cells[partialDetail.columns[2].id], undefined, 'attachment column holds no imported text');
  assert.equal(partialRows[1].cells[partialDetail.columns[0].id], 'Perro', 'row order follows the CSV');

  // Progress is reported so a long import can show a bar instead of freezing silently.
  const ticks = [];
  dbmode.createDatabaseFromCsv('Progreso', ['N'], [['a'], ['b']], ['title'], (done, total) => ticks.push([done, total]));
  assert.ok(ticks.length > 0 && ticks[ticks.length - 1][0] === 2, 'progress reaches the final row');

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

  // ── Formula columns (shared/databaseFormula + databaseFormulaEval, pure) ───
  const fCol = (id, name, type, config = {}) => ({ id, name, type, config, options: [], position: 0, databaseId: 'db', createdAt: '' });
  const fRow = (id, cells) => ({ id, databaseId: 'db', position: 0, cells, createdAt: '', updatedAt: '' });
  const fTitle = fCol('t', 'Nombre', 'title');
  const fA = fCol('a', 'Peso', 'number');
  const fB = fCol('b', 'Cantidad', 'number');
  const fBase = [fTitle, fA, fB];
  /** Run one spec over rows and return the computed column's values. */
  const runFormula = (spec, rows, extra = {}) => {
    formulaEval.computeFormulas(rows, [...fBase, fCol('f', 'F', 'formula', { formula: spec, ...extra })]);
    return rows.map((r) => r.cells.f);
  };
  const abRows = () => [fRow('r1', { t: 'x', a: '10', b: '4' }), fRow('r2', { t: 'y', a: '3', b: '0' }), fRow('r3', { t: 'z', a: '', b: '5' })];
  const ab = (op) => runFormula({ kind: 'arithmetic', op, operands: [{ kind: 'column', columnId: 'a' }, { kind: 'column', columnId: 'b' }] }, abRows());

  // Blanks: a missing value is "no value", so the set operations skip it, but a positional
  // one (a − b) has no answer without it. Dividing by zero has no answer either.
  assert.deepEqual(ab('add'), ['14', '3', '5']);
  assert.deepEqual(ab('subtract'), ['6', '3', null], 'subtract needs every operand');
  assert.deepEqual(ab('multiply'), ['40', '0', '5']);
  assert.deepEqual(ab('divide'), ['2.5', null, null], 'divide by zero yields no value');
  assert.deepEqual(ab('average'), ['7', '1.5', '5'], 'average ignores blanks rather than counting them as 0');
  assert.deepEqual(ab('min'), ['4', '0', '5']);
  assert.deepEqual(ab('max'), ['10', '3', '5']);
  assert.deepEqual(ab('median'), ['7', '1.5', '5']);
  assert.deepEqual(ab('countFilled'), ['2', '2', '1']);
  assert.deepEqual(
    runFormula({ kind: 'arithmetic', op: 'add', operands: [{ kind: 'column', columnId: 'a' }, { kind: 'number', value: 100 }] }, abRows()),
    ['110', '103', '100'],
    'a fixed number is a valid operand, and the blank row is still just 100'
  );

  const statRows = () => [fRow('r1', { a: '50' }), fRow('r2', { a: '30' }), fRow('r3', { a: '20' })];
  const stat = (fn) => runFormula({ kind: 'columnStat', fn, columnId: 'a' }, statRows());
  assert.deepEqual(stat('percentOfTotal'), ['50', '30', '20']);
  assert.deepEqual(stat('rank'), ['1', '2', '3'], 'rank 1 is the highest value');
  assert.deepEqual(stat('columnTotal'), ['100', '100', '100'], 'a column total is the same on every row');
  // Stored at full precision, not at display precision — see the 1000-row check below.
  assert.deepEqual(stat('percentile'), ['66.6666666667', '33.3333333333', '0']);
  // Precision is a display concern: storing a rounded % would stop the column adding to 100.
  const thousandRows = Array.from({ length: 1000 }, (_, i) => fRow(`r${i}`, { a: '1' }));
  const pcts = runFormula({ kind: 'columnStat', fn: 'percentOfTotal', columnId: 'a' }, thousandRows);
  const pctSum = pcts.reduce((n, v) => n + Number(v), 0);
  assert.ok(Math.abs(pctSum - 100) < 1e-6, `1000 rows of "% of total" must still add to 100, got ${pctSum}`);
  assert.equal(formulaEval.evaluateFormula(
    { kind: 'arithmetic', op: 'add', operands: [{ kind: 'number', value: 0.1 }, { kind: 'number', value: 0.2 }] },
    fRow('r', {}),
    { columns: new Map(), stats: new Map() }
  ).value, '0.3', 'floating-point noise is cleaned up');

  const ifSpec = {
    kind: 'ifThen',
    rules: [
      { id: '1', conjunction: 'and', conditions: [{ id: 'c', columnId: 'a', op: 'gt', value: '5' }], output: { kind: 'text', value: 'Alto' }, color: '#10b981' },
      { id: '2', conjunction: 'and', conditions: [{ id: 'c', columnId: 't', op: 'equals', value: 'z' }], output: { kind: 'text', value: 'Es Z' }, color: '#ef4444' },
    ],
    otherwise: { kind: 'text', value: 'Normal' },
  };
  const ifRows = abRows();
  assert.deepEqual(runFormula(ifSpec, ifRows), ['Alto', 'Normal', 'Es Z'], 'the first matching rule wins');
  assert.equal(ifRows[0].formulaColors.f, '#10b981', 'the winning rule paints the cell');
  assert.equal(ifRows[1].formulaColors, undefined, 'a colourless fallback paints nothing');
  // Two conditions on one rule, combined by the rule's own conjunction.
  const andRule = {
    kind: 'ifThen',
    rules: [{
      id: '1', conjunction: 'and',
      conditions: [{ id: 'c1', columnId: 'a', op: 'gt', value: '5' }, { id: 'c2', columnId: 'b', op: 'gt', value: '3' }],
      output: { kind: 'text', value: 'Ambas' },
    }],
    otherwise: { kind: 'empty' },
  };
  assert.deepEqual(runFormula(andRule, abRows()), ['Ambas', null, null], 'Y requires both conditions');
  assert.deepEqual(
    runFormula({ ...andRule, rules: [{ ...andRule.rules[0], conjunction: 'or' }] }, abRows()),
    ['Ambas', null, 'Ambas'],
    'O requires either condition'
  );
  assert.deepEqual(
    runFormula({ kind: 'ifThen', rules: [{ id: '1', conjunction: 'and', conditions: [{ id: 'c', columnId: 'a', op: 'gt', value: '5' }], output: { kind: 'column', columnId: 'b' } }], otherwise: { kind: 'empty' } }, abRows()),
    ['4', null, null],
    'a rule can output another column value'
  );

  assert.deepEqual(
    runFormula({ kind: 'concat', parts: [{ kind: 'column', columnId: 't' }, { kind: 'text', value: ' (' }, { kind: 'column', columnId: 'a' }, { kind: 'text', value: ')' }] }, abRows()),
    ['x (10)', 'y (3)', 'z ()'],
    'concat joins in order'
  );

  // Result kind drives how the column filters and sorts.
  assert.equal(formulaShared.formulaResultKind({ kind: 'arithmetic', op: 'add', operands: [] }), 'number');
  assert.equal(formulaShared.formulaResultKind({ kind: 'concat', parts: [] }), 'text');
  assert.equal(formulaShared.formulaResultKind(ifSpec), 'text');
  assert.equal(
    formulaShared.formulaResultKind({ kind: 'ifThen', rules: [{ id: '1', conjunction: 'and', conditions: [], output: { kind: 'number', value: 1 } }], otherwise: { kind: 'number', value: 0 } }),
    'number',
    'an if whose branches are all numbers is a number column'
  );
  assert.equal(formulaShared.comparableType(fCol('f', 'F', 'formula', { formula: { kind: 'arithmetic', op: 'add', operands: [] } })), 'number');
  assert.equal(formulaShared.comparableType(fA), 'number', 'a non-formula column is itself');
  assert.ok(filters.operatorsForColumn(fCol('f', 'F', 'formula', { formula: { kind: 'concat', parts: [] } })).includes('contains'));
  assert.ok(filters.operatorsForColumn(fCol('f', 'F', 'formula', { formula: { kind: 'arithmetic', op: 'add', operands: [] } })).includes('gt'));

  // A formula may build on another; evaluation order follows the dependencies, not the columns.
  const totalCol = fCol('tot', 'Total', 'formula', { formula: { kind: 'arithmetic', op: 'add', operands: [{ kind: 'column', columnId: 'a' }, { kind: 'column', columnId: 'b' }] } });
  const pctCol = fCol('pct', 'Pct', 'formula', { formula: { kind: 'columnStat', fn: 'percentOfTotal', columnId: 'tot' } });
  const chained = abRows();
  formulaEval.computeFormulas(chained, [...fBase, pctCol, totalCol]); // dependent column declared first
  assert.deepEqual(chained.map((r) => r.cells.tot), ['14', '3', '5'], 'the dependency is computed first');
  assert.equal(chained[0].cells.pct, '63.6363636364');

  // A circular reference is reported, never hung on.
  const c1 = fCol('c1', 'C1', 'formula', { formula: { kind: 'arithmetic', op: 'add', operands: [{ kind: 'column', columnId: 'c2' }] } });
  const c2 = fCol('c2', 'C2', 'formula', { formula: { kind: 'arithmetic', op: 'add', operands: [{ kind: 'column', columnId: 'c1' }] } });
  const cyc = [fRow('r1', {})];
  formulaEval.computeFormulas(cyc, [fA, c1, c2]);
  assert.match(cyc[0].formulaErrors.c1, /circular/i);
  assert.match(cyc[0].formulaErrors.c2, /circular/i);

  // A half-built formula explains itself instead of rendering a blank.
  assert.equal(formulaShared.validateFormula(null, []), 'Esta columna todavía no tiene fórmula.');
  assert.match(formulaShared.validateFormula({ kind: 'arithmetic', op: 'add', operands: [{ kind: 'column', columnId: 'a' }] }, fBase), /al menos dos/);
  assert.match(formulaShared.validateFormula({ kind: 'columnStat', fn: 'rank', columnId: '' }, fBase), /Elige la columna/);
  assert.match(formulaShared.validateFormula({ kind: 'ifThen', rules: [], otherwise: { kind: 'empty' } }, fBase), /al menos una regla/);
  assert.match(
    formulaShared.validateFormula({ kind: 'arithmetic', op: 'add', operands: [{ kind: 'column', columnId: 'gone' }, { kind: 'column', columnId: 'a' }] }, fBase),
    /ya no existe/,
    'a deleted source column is reported'
  );
  assert.deepEqual(formulaShared.formulaDependencies(ifSpec).sort(), ['a', 't']);

  // Colour rules paint any recipe's result, not just an if's branches.
  const colored = abRows();
  formulaEval.computeFormulas(colored, [
    ...fBase,
    fCol('f', 'F', 'formula', {
      formula: { kind: 'arithmetic', op: 'add', operands: [{ kind: 'column', columnId: 'a' }, { kind: 'column', columnId: 'b' }] },
      formulaColors: [{ id: 'x', op: 'gt', value: '10', color: '#ef4444' }],
    }),
  ]);
  assert.equal(colored[0].formulaColors.f, '#ef4444', '14 > 10 is painted');
  assert.equal(colored[1].formulaColors, undefined, '3 is not');

  // The description is the column's own explanation, in words.
  assert.equal(formulaEval.describeFormula({ kind: 'arithmetic', op: 'add', operands: [{ kind: 'column', columnId: 'a' }, { kind: 'column', columnId: 'b' }] }, fBase), 'Peso + Cantidad');
  assert.equal(formulaEval.describeFormula({ kind: 'columnStat', fn: 'percentOfTotal', columnId: 'a' }, fBase), '% del total de Peso');
  assert.match(formulaEval.describeFormula(ifSpec, fBase), /si Peso mayor que 5 → «Alto»/);

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

  // ── Catalogue-code matching ────────────────────────────────────────────────
  // Real exports carry debris around the code on both sides: variant suffixes on files
  // ("LV005-FG069__2"), junk prefixes, and stray characters on the reference value.
  assert.equal(bulk.extractCode('LV001-FG001.jpg'), 'lv001-fg001');
  assert.equal(bulk.extractCode('lv005-fg069__2'), 'lv005-fg069', 'a variant suffix is not part of the code');
  assert.equal(bulk.extractCode('_ _ lv130-fg006'), 'lv130-fg006', 'a junk prefix is skipped');
  assert.equal(bulk.extractCode('LV037-FG189.158 Quilla'), 'lv037-fg189', 'trailing text is not part of the code');
  assert.equal(bulk.extractCode('sin codigo aqui'), null);
  const coded = bulk.matchFilesToRows(
    ['LV005-FG069__1.png', 'LV005-FG069__2.png', '_ _ LV130-FG006.jpg', 'suelto.jpg'],
    [
      { rowId: 'a', refValue: 'LV005-FG069' },
      { rowId: 'b', refValue: 'LV130-FG006·' },
    ]
  );
  assert.equal(coded[0].rowId, 'a');
  assert.equal(coded[1].rowId, 'a', 'both variants land on the same row');
  assert.equal(coded[0].strategy, 'code');
  assert.equal(coded[2].rowId, 'b', 'a stray character on the reference value still matches');
  assert.equal(coded[3].rowId, null, 'a file with no code stays unmatched');
  assert.deepEqual(bulk.summarizeMatches(coded), { exact: 0, code: 3, fuzzy: 0, unmatched: 1, fuzzyDeclined: false });
  // An exact name always wins over a code, so a confident match is never displaced.
  const exactWins = bulk.matchFilesToRows(
    ['LV001-FG001.jpg'],
    [{ rowId: 'other', refValue: 'LV001-FG001 bis' }, { rowId: 'exact', refValue: 'LV001-FG001' }]
  );
  assert.equal(exactWins[0].rowId, 'exact');
  assert.equal(exactWins[0].strategy, 'exact');
  // useCode: false restores the old exact-only behaviour.
  assert.equal(bulk.matchFilesToRows(['LV005-FG069__1.png'], [{ rowId: 'a', refValue: 'LV005-FG069' }], { useCode: false })[0].rowId, null);

  // ── User-supplied code templates ──────────────────────────────────────────
  assert.equal(bulk.extractCode('foto AB123 final', bulk.codeTemplateToRegex('@@###')), 'ab123');
  assert.equal(bulk.extractCode('x LV001-FG001 y', bulk.codeTemplateToRegex('@@###-@@###')), 'lv001-fg001');
  assert.equal(bulk.extractCode('ref 42 aqui', bulk.codeTemplateToRegex('/\\d+/')), '42', 'a raw regex body is honoured');
  assert.equal(bulk.codeTemplateToRegex('   '), null, 'an empty template is not a pattern');
  assert.equal(bulk.codeTemplateToRegex('/[/'), null, 'an invalid regex is rejected, not thrown');

  // ── Fuzzy fallback ────────────────────────────────────────────────────────
  const fuzzyRows = [{ rowId: 'f1', refValue: 'Informe Anual Definitivo' }];
  const fz = bulk.matchFilesToRows(['informe_anual_definitivo (copia).pdf'], fuzzyRows, { fuzzy: true });
  assert.equal(fz[0].rowId, 'f1', 'a near-identical name pairs when fuzzy is on');
  assert.equal(fz[0].strategy, 'fuzzy');
  assert.ok(fz[0].score >= 0.6);
  // Off by default: a wrong attachment is worse than none.
  assert.equal(bulk.matchFilesToRows(['informe_anual_definitivo (copia).pdf'], fuzzyRows)[0].rowId, null);
  // A name with nothing in common is refused even with fuzzy on.
  assert.equal(bulk.matchFilesToRows(['zzzz.pdf'], fuzzyRows, { fuzzy: true })[0].rowId, null);
  // Two rows that score alike are indistinguishable, so neither is guessed.
  const tie = bulk.matchFilesToRows(
    ['documento uno.pdf'],
    [{ rowId: 't1', refValue: 'Documento Uno A' }, { rowId: 't2', refValue: 'Documento Uno B' }],
    { fuzzy: true }
  );
  assert.equal(tie[0].rowId, null, 'an ambiguous fuzzy winner is refused');
  // The fuzzy pass is O(leftovers x rows): past its budget it declines instead of hanging.
  const many = Array.from({ length: 1200 }, (_, i) => `archivo-${i}.jpg`);
  const manyRows = Array.from({ length: 1200 }, (_, i) => ({ rowId: `m${i}`, refValue: `Fila ${i}` }));
  const declined = bulk.matchFilesToRows(many, manyRows, { fuzzy: true });
  assert.ok(bulk.summarizeMatches(declined).fuzzyDeclined, 'an unaffordable fuzzy pass is declined, not run');

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
  assert.match(chatCtx.context, /MUESTRA/, 'chat context includes a row sample');
  assert.ok(chatCtx.names.includes('Perfil'));
  // The profile is computed over every row while the sample is a handful of examples, so both
  // have to say which they are: a model shown 15 numbered rows answers "15" when asked how
  // many rows the table has, and reports that with total confidence.
  assert.match(chatCtx.context, /PERFIL \(calculado sobre las 3 filas\)/, 'the profile states its scope');
  assert.match(chatCtx.context, /MUESTRA: 3 filas de ejemplo de 3/, 'the sample states it is a sample of the whole');
  assert.match(chatCtx.context, /no cuentes sobre ella/, 'and that it must not be counted');
  assert.match(chatShared.DB_CHAT_SYSTEM, /única fuente válida para totales/, 'the system prompt names the profile as the only source of figures');

  // A single long cell must not be allowed to crowd out the profile: real catalogues carry
  // 3k-character description fields, and 15 of those bury the figures the answers come from
  // (and push the prompt past a local model's window, which truncates it silently).
  const longDb = dbmode.createDatabase('Largo');
  const lTitle = dbmode.createColumn(longDb.id, 'Nombre', 'title');
  const lText = dbmode.createColumn(longDb.id, 'Descripcion', 'text');
  const lRow = dbmode.createRow(longDb.id);
  dbmode.setCell(lRow.id, lTitle.id, 'Ficha');
  dbmode.setCell(lRow.id, lText.id, 'palabra '.repeat(500));
  const longCtx = buildDatabaseChatContext([longDb.id]).context;
  const sampleBlock = longCtx.slice(longCtx.indexOf('MUESTRA'));
  assert.ok(sampleBlock.length < 1000, `a 4000-char cell must be clipped in the sample, block was ${sampleBlock.length}`);
  assert.match(sampleBlock, /…/, 'the clipped value is marked as clipped');

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
