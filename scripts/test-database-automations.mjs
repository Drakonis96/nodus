// Loop 15 acceptance: idempotent automations, retries, schedules, buttons and real HTTP forms on SQLite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const require = createRequire(import.meta.url);
const marker = '--electron-database-automations-test';
if (!process.argv.includes(marker)) { execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [fileURLToPath(import.meta.url), marker], {
  cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
}); process.exit(0); }

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-database-automations-')); installRuntimeHooks(root);
let webhookServer = null; let formServer = null;
try {
  const Database = require('better-sqlite3'); const { migrations, runMigrations, SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const databases = require(path.join(repoRoot, 'electron/db/databasesRepo.ts')); const automations = require(path.join(repoRoot, 'electron/db/databaseAutomationsRepo.ts'));
  formServer = require(path.join(repoRoot, 'electron/automation/formServer.ts'));

  const historical = new Database(path.join(root, 'historical-v144.sqlite')); migrateThrough(historical, migrations, 144); runMigrations(historical);
  assert.equal(historical.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  for (const table of ['automation_rules','automation_runs','automation_notifications','database_forms','database_form_fields','database_form_submissions','database_form_rate_limits'])
    assert.ok(historical.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} migrated`);
  historical.close();

  const sqlite = new Database(path.join(root, 'automations.sqlite')); runMigrations(sqlite); globalThis.__databaseAutomationsDb = sqlite;
  const database = databases.createDatabase('Solicitudes'); const title = databases.createColumn(database.id, 'Nombre', 'title');
  const status = databases.createColumn(database.id, 'Estado', 'text'); const result = databases.createColumn(database.id, 'Resultado', 'rich_text');
  const button = databases.createColumn(database.id, 'Aprobar', 'button', { buttonLabel: 'Aprobar' });
  const relation = databases.createColumn(database.id, 'Relacionadas', 'relation', { relationTargetKind: 'db_row', relationTargetDatabaseId: database.id });
  const source = databases.createRow(database.id); databases.setCell(source.id, title.id, 'Ada'); const related = databases.createRow(database.id); databases.setCell(related.id, title.id, 'Grace');
  databases.addRelation(source.id, relation.id, 'db_row', related.id);

  const propertyRule = automations.createAutomationRule(database.id, { name: 'Completar al aprobar', trigger: { type: 'property_changed', columnId: status.id },
    condition: { type: 'condition', columnId: status.id, op: 'equals', value: 'aprobado' }, actions: [
      { type: 'set_property', columnId: result.id, value: { type: 'template', template: 'Aceptada: {{row.title}}' } },
      { type: 'notify', title: 'Solicitud aprobada', body: '{{row.title}} ya está lista' },
    ], maxDepth: 4 });
  databases.setCell(source.id, status.id, 'aprobado'); const firstRuns = await automations.dispatchAutomationEvent({ type: 'property_changed', databaseId: database.id, rowId: source.id, columnId: status.id, eventKey: 'event:approval:1' });
  assert.equal(firstRuns[0].status, 'succeeded'); assert.equal(databases.getRow(source.id).cells[result.id], 'Aceptada: Ada');
  assert.equal(automations.listAutomationNotifications(database.id).length, 1);
  const repeatedRuns = await automations.dispatchAutomationEvent({ type: 'property_changed', databaseId: database.id, rowId: source.id, columnId: status.id, eventKey: 'event:approval:1' });
  assert.equal(repeatedRuns[0].id, firstRuns[0].id); assert.equal(automations.listAutomationNotifications(database.id).length, 1, 'event key is idempotent');
  const stale = automations.updateAutomationRule(propertyRule.id, { name: 'Cambio obsoleto' }, 0); assert.equal(stale.ok, false); assert.equal(stale.conflict, true);

  const loopRule = automations.createAutomationRule(database.id, { name: 'Bucle acotado', trigger: { type: 'property_changed', columnId: result.id },
    actions: [{ type: 'set_property', columnId: result.id, value: { type: 'literal', value: 'estable' } }], maxDepth: 2 });
  const loopRun = await automations.runAutomationRule(loopRule.id, source.id, 'manual:loop'); assert.equal(loopRun.status, 'succeeded');
  assert.ok(automations.listAutomationRuns(database.id).some((run) => run.status === 'skipped' && run.eventKey.includes(':set:')), 'recursive rule is skipped before looping');

  let webhookRequests = 0; webhookServer = createServer((request, response) => { webhookRequests += 1; let body = ''; request.on('data', (chunk) => { body += chunk; }); request.on('end', () => {
    assert.match(body, new RegExp(source.id)); response.writeHead(webhookRequests === 1 ? 503 : 204); response.end();
  }); });
  await new Promise((resolve) => webhookServer.listen(0, '127.0.0.1', resolve)); const webhookPort = webhookServer.address().port;
  const webhookRule = automations.createAutomationRule(database.id, { name: 'Webhook reintentable', enabled: false, trigger: { type: 'row_created' }, maxAttempts: 3, retryDelayMs: 5,
    actions: [{ type: 'webhook', url: `http://127.0.0.1:${webhookPort}/hook`, method: 'POST', headers: { 'x-row': '{{row.id}}' }, body: '{"row":"{{row.id}}"}' }] });
  const webhookRun = await automations.runAutomationRule(webhookRule.id, source.id, 'manual:webhook'); assert.equal(webhookRun.status, 'succeeded'); assert.equal(webhookRun.attempt, 2); assert.equal(webhookRequests, 2);

  const relatedRule = automations.createAutomationRule(database.id, { name: 'Actualizar relacionadas', enabled: false, trigger: { type: 'row_created' },
    actions: [{ type: 'update_related', relationColumnId: relation.id, changes: [{ columnId: result.id, value: { type: 'template', template: 'Desde {{row.title}}' } }] }] });
  assert.equal((await automations.runAutomationRule(relatedRule.id, source.id, 'manual:related')).status, 'succeeded'); assert.equal(databases.getRow(related.id).cells[result.id], 'Desde Ada');
  const beforePages = sqlite.prepare('SELECT COUNT(*) AS n FROM db_rows WHERE database_id=?').get(database.id).n;
  const pageRule = automations.createAutomationRule(database.id, { name: 'Crear página', enabled: false, trigger: { type: 'row_created' }, actions: [{ type: 'create_page', databaseId: database.id,
    properties: { [title.id]: { type: 'template', template: 'Seguimiento de {{row.title}}' } }, blocks: [{ type: 'paragraph', content: { text: 'Creada por automatización' } }] }] });
  assert.equal((await automations.runAutomationRule(pageRule.id, source.id, 'manual:create')).status, 'succeeded'); assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM db_rows WHERE database_id=?').get(database.id).n, beforePages + 1);

  const buttonRule = automations.createAutomationRule(database.id, { name: 'Botón aprobar', trigger: { type: 'button', columnId: button.id }, actions: [{ type: 'set_property', columnId: status.id, value: { type: 'literal', value: 'por-botón' } }] });
  const buttonRuns = await automations.runDatabaseButtonAutomation(button.id, source.id); assert.equal(buttonRuns[0].ruleId, buttonRule.id); assert.equal(buttonRuns[0].status, 'succeeded');
  assert.equal(databases.getRow(source.id).cells[status.id], 'por-botón'); assert.equal(JSON.parse(databases.getRow(source.id).cells[button.id]).clicks, 1);

  const scheduleRule = automations.createAutomationRule(database.id, { name: 'Resumen diario', trigger: { type: 'schedule', recurrence: 'daily', nextRunAt: '2026-08-14T08:00:00.000Z', timeZone: 'Europe/Madrid' }, actions: [{ type: 'notify', title: 'Resumen', body: 'Listo' }] });
  const due = await automations.runDueAutomationRules('2026-08-14T09:00:00.000Z'); assert.equal(due.some((run) => run.ruleId === scheduleRule.id), true);
  assert.equal((await automations.runDueAutomationRules('2026-08-14T09:00:00.000Z')).length, 0, 'scheduled instant advances before execution');

  const form = automations.createDatabaseForm(database.id, { name: 'Solicitud pública', slug: 'solicitud-publica', title: 'Únete', description: 'Cuéntanos quién eres', access: 'public', rateLimitCount: 2, rateLimitMinutes: 60,
    fields: [{ columnId: title.id, label: 'Tu nombre', description: 'Nombre visible', required: true, width: 'full' }, { columnId: status.id, label: 'Estado', description: null, required: false, width: 'half' }],
    confirmationTitle: 'Recibido', confirmationBody: 'Gracias por responder.' });
  assert.throws(() => automations.createDatabaseForm(database.id, { name: 'Duplicado', slug: 'solicitud-publica', fields: [{ columnId: title.id, label: 'Nombre', required: true, description: null, width: 'full' }] }), /URL/);
  assert.equal((await automations.submitDatabaseForm(form.id, { [title.id]: 'Lin', [status.id]: 'nueva' }, 'test', 'fingerprint-a')).status, 'accepted');
  await assert.rejects(() => automations.submitDatabaseForm(form.id, { [title.id]: '' }, 'test', 'fingerprint-b'), /obligatorio/);
  const formConflict = automations.updateDatabaseForm(form.id, { name: form.name, slug: form.slug, fields: form.fields.map((field) => ({ columnId: field.columnId, label: field.label, description: field.description, required: field.required, width: field.width })) }, 0);
  assert.equal(formConflict.ok, false); assert.equal(formConflict.conflict, true);

  const authenticated = automations.createDatabaseForm(database.id, { name: 'Privado', slug: 'privado', access: 'authenticated', authToken: 'secreto-real', fields: [{ columnId: title.id, label: 'Nombre', description: null, required: true, width: 'full' }] });
  assert.equal(automations.authenticateDatabaseForm(authenticated.id, 'incorrecto'), false); assert.equal(automations.authenticateDatabaseForm(authenticated.id, 'secreto-real'), true);
  const statusServer = await formServer.startDatabaseFormServer(0); assert.equal(statusServer.running, true); const origin = statusServer.origin;
  const publicGet = await fetch(`${origin}/forms/solicitud-publica`); assert.equal(publicGet.status, 200); assert.match(await publicGet.text(), /Únete/);
  const publicPost = await fetch(`${origin}/forms/solicitud-publica`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'loop-15-public' }, body: new URLSearchParams({ [`field_${title.id}`]: 'Katherine', [`field_${status.id}`]: 'web' }) });
  assert.equal(publicPost.status, 200); assert.match(await publicPost.text(), /Recibido/);
  const secondPublicPost = await fetch(`${origin}/forms/solicitud-publica`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'loop-15-public' }, body: new URLSearchParams({ [`field_${title.id}`]: 'Margaret' }) }); assert.equal(secondPublicPost.status, 200);
  const limitedPost = await fetch(`${origin}/forms/solicitud-publica`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'loop-15-public' }, body: new URLSearchParams({ [`field_${title.id}`]: 'Exceso' }) }); assert.equal(limitedPost.status, 429);
  assert.equal((await fetch(`${origin}/forms/privado`)).status, 401); const rejectedToken = await fetch(`${origin}/forms/privado?token=incorrecto`); assert.equal(rejectedToken.status, 401); assert.match(await rejectedToken.text(), /token no es válido/i); assert.equal((await fetch(`${origin}/forms/privado?token=secreto-real`)).status, 200);
  const privatePost = await fetch(`${origin}/forms/privado`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _token: 'secreto-real', [`field_${title.id}`]: 'Dorothy' }) }); assert.equal(privatePost.status, 200);
  assert.ok(automations.listDatabaseFormSubmissions(form.id).length >= 3); assert.equal(formServer.databaseFormPublicUrl('privado'), `${origin}/forms/privado`);

  const snapshot = fs.readFileSync(path.join(repoRoot, 'electron/serverSync/serverSnapshot.ts'), 'utf8'); const syncTables = fs.readFileSync(path.join(repoRoot, 'electron/db/syncTables.ts'), 'utf8');
  const outbox = fs.readFileSync(path.join(repoRoot, 'electron/serverSync/outboxTriggers.ts'), 'utf8'); const serverMutations = fs.readFileSync(path.join(repoRoot, 'server/lib/core/mutations.mjs'), 'utf8');
  for (const table of ['automation_rules','automation_runs','automation_notifications','database_forms','database_form_fields','database_form_submissions']) {
    for (const sourceText of [snapshot,syncTables,outbox]) assert.match(sourceText, new RegExp(`['\"]${table}['\"]`), `${table} covered by desktop sync`);
    assert.match(serverMutations, new RegExp(`(?:['\"]${table}['\"]|\\b${table}\\s*:)`), `${table} covered by server mutations`);
  }
  assert.match(snapshot, /'auth_token_hash'/, 'form secrets are stripped from publication');
  assert.deepEqual(sqlite.pragma('foreign_key_check'), []); assert.equal(sqlite.pragma('quick_check', { simple: true }), 'ok');
  console.log('database automations, retries, schedules, buttons and real HTTP forms test passed');
} finally {
  if (formServer) await formServer.stopDatabaseFormServer();
  if (webhookServer) await new Promise((resolve) => webhookServer.close(resolve));
  if (globalThis.__databaseAutomationsDb?.open) globalThis.__databaseAutomationsDb.close();
  await rm(root, { recursive: true, force: true });
}

function migrateThrough(db, migrations, version) { db.pragma('foreign_keys = ON'); for (const migration of migrations.filter((item) => item.version <= version).sort((a,b) => a.version-b.version)) db.transaction(() => { db.exec(migration.up); migration.after?.(db); db.pragma(`user_version = ${migration.version}`); })(); }
function installRuntimeHooks(userDataPath) {
  const ts = require('typescript'); const Module = require('node:module'); const originalResolveFilename = Module._resolveFilename; const originalLoad = Module._load;
  const databaseStub = path.join(userDataPath, 'stub-database.cjs'); fs.writeFileSync(databaseStub, 'exports.getDb = () => globalThis.__databaseAutomationsDb;\n');
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) { if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`); const resolved = originalResolveFilename.call(this, request, parent, isMain, options); return resolved === path.join(repoRoot, 'electron/db/database.ts') ? databaseStub : resolved; };
  Module._load = function load(request, parent, isMain) { if (request === 'electron') return { app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false }, BrowserWindow: class {}, dialog: {}, shell: {} }; return originalLoad.call(this, request, parent, isMain); };
  require.extensions['.ts'] = function loadTs(module, filename) { module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename }).outputText, filename); };
}
