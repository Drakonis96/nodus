#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
if (!requireElectronRuntime(path.join(repoRoot, 'scripts/test-notion-zip-import.mjs'), '--electron-notion-import-test')) process.exit(0);

const qaRoot = process.env.NODUS_QA_ROOT ? path.resolve(process.env.NODUS_QA_ROOT) : null;
const requested = process.env.NODUS_USERDATA ? path.resolve(process.env.NODUS_USERDATA) : null;
if (requested && (!qaRoot || (requested !== qaRoot && !requested.startsWith(`${qaRoot}${path.sep}`)))) {
  throw new Error('NODUS_USERDATA for the Notion import suite must remain under NODUS_QA_ROOT.');
}
const userData = requested ? path.join(requested, 'notion-import-test') : await mkdtemp(path.join(os.tmpdir(), 'nodus-notion-import-'));
await mkdir(userData, { recursive: true });
installRuntimeHooks(userData);

const AdmZip = require('adm-zip');
const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
const { importNotionZip } = require(path.join(repoRoot, 'electron/import/notionZipImport.ts'));
const dbRepo = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
const pageRepo = require(path.join(repoRoot, 'electron/db/pagesRepo.ts'));
const { exportDatabaseToFile } = require(path.join(repoRoot, 'electron/export/databaseExport.ts'));

const id = (char) => char.repeat(32);
const fixturePath = path.join(userData, 'notion-complete-fixture.zip');
const image = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

function completeFixture(destination) {
  const zip = new AdmZip();
  const database = `Workspace/Projects ${id('a')}`;
  zip.addFile(`${database}.csv`, Buffer.from([
    'Name,Status,Due,Done,Tags',
    'Alpha,In progress,2026-08-20,false,"research, urgent"',
    'Beta,Done,2026-08-21,true,research',
  ].join('\n')));
  zip.addFile(`${database}/Alpha ${id('b')}.md`, Buffer.from('# Alpha details\n\n![Evidence](assets/evidence.png)\n\n- [x] Verified'));
  zip.addFile(`${database}/Beta ${id('c')}.md`, Buffer.from('## Beta details\n\nA durable row page.'));
  zip.addFile(`${database}/assets/evidence.png`, image);
  zip.addFile(`Workspace/Home ${id('d')}.md`, Buffer.from('# Home\n\nWorkspace root.'));
  zip.addFile(`Workspace/Home ${id('d')}/Child ${id('e')}.md`, Buffer.from('## Child\n\n![Same bytes](assets/copy.png)'));
  zip.addFile(`Workspace/Home ${id('d')}/assets/copy.png`, image);
  zip.writeZip(destination);
}

test('a real Notion ZIP becomes typed databases, universal row pages, a page tree and deduplicated assets', async () => {
  completeFixture(fixturePath);
  const report = importNotionZip(fixturePath);
  assert.equal(report.format, 'nodus.notion-import-report');
  assert.equal(report.databases, 1);
  assert.equal(report.rows, 2);
  assert.equal(report.rowPages, 2);
  assert.equal(report.pages, 2);
  assert.equal(report.assets, 2);
  assert.equal(report.deduplicatedAssets, 1);
  assert.ok(report.notices.some((notice) => notice.kind === 'unavailable'));

  const detail = dbRepo.getDatabaseDetail(report.createdDatabaseIds[0]);
  assert.equal(detail.database.name, 'Projects');
  assert.deepEqual(detail.columns.map((column) => column.type), ['title', 'status', 'date', 'checkbox', 'multi_select']);
  const rows = dbRepo.listRows(detail.database.id, { sort: 'position', limit: 10 });
  assert.equal(rows.length, 2);
  const alpha = pageRepo.getPageDocumentForRow(rows[0].id);
  const beta = pageRepo.getPageDocumentForRow(rows[1].id);
  assert.match(alpha.markdown, /Alpha details/);
  assert.match(alpha.markdown, /nodus-blob:\/\/[0-9a-f]{64}/);
  assert.match(beta.markdown, /durable row page/i);

  const pages = pageRepo.listPages('active').filter((page) => report.createdPageIds.includes(page.id));
  assert.equal(pages.length, 2);
  const home = pages.find((page) => page.title === 'Home');
  const child = pages.find((page) => page.title === 'Child');
  assert.equal(child.parentPageId, home.id);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM db_blobs').get().n, 1, 'identical assets occupy one blob');
  assert.equal(getDb().pragma('quick_check', { simple: true }), 'ok');
  assert.deepEqual(getDb().pragma('foreign_key_check'), []);

  const exported = path.join(userData, 'projects-roundtrip.json');
  const metrics = await exportDatabaseToFile(detail.database.id, 'json', exported);
  assert.equal(metrics.rows, 2);
  assert.ok(metrics.maxPageRows <= 500);
  const roundtrip = JSON.parse(require('node:fs').readFileSync(exported, 'utf8'));
  assert.equal(roundtrip.rows.length, 2);
  assert.match(roundtrip.rows[0]._page.markdown, /Alpha details/);
});

test('a failure after creating rows rolls back the entire import', () => {
  const before = {
    databases: getDb().prepare('SELECT COUNT(*) AS n FROM db_databases').get().n,
    pages: getDb().prepare('SELECT COUNT(*) AS n FROM pages').get().n,
    blobs: getDb().prepare('SELECT COUNT(*) AS n FROM db_blobs').get().n,
  };
  const zip = new AdmZip();
  zip.addFile(`Broken ${id('f')}.csv`, Buffer.from('Name\nCreated before failure'));
  zip.addFile(`Overflow ${id('0')}.md`, Buffer.from(Array.from({ length: 10_001 }, (_, index) => `# Block ${index}`).join('\n')));
  const broken = path.join(userData, 'notion-rollback-fixture.zip');
  zip.writeZip(broken);
  assert.throws(() => importNotionZip(broken), /10\.000 bloques/);
  assert.deepEqual({
    databases: getDb().prepare('SELECT COUNT(*) AS n FROM db_databases').get().n,
    pages: getDb().prepare('SELECT COUNT(*) AS n FROM pages').get().n,
    blobs: getDb().prepare('SELECT COUNT(*) AS n FROM db_blobs').get().n,
  }, before);
});

test.after(async () => {
  closeDb();
  if (!requested) await rm(userData, { recursive: true, force: true });
});
