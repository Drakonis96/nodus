/** Disposable Zotero fixture preparer. Never used by the Research connector. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createResearchTestRoot, macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';

const root = createResearchTestRoot();
const policy = macResearchSandbox(root);
const proof = verifyResearchSandbox(root, policy);
let providerProxy;
if (process.argv.includes('--live')) {
  const campaignRoot = process.argv.find(argument => argument.startsWith('--campaign-root='))?.slice('--campaign-root='.length);
  if (!campaignRoot) throw new Error('Live runs require the same explicit --campaign-root for the entire $5 campaign');
  const { startResearchProviderProxy } = await import('./research-provider-proxy.mjs');
  providerProxy = await startResearchProviderProxy(campaignRoot);
  const { importResearchTestCredentials } = await import('./research-test-credentials.mjs');
  try { importResearchTestCredentials(root); } catch (error) { await providerProxy.close(); throw error; }
}
const profile = path.join(root, 'zotero/profile');
const data = path.join(root, 'zotero/data');
fs.mkdirSync(path.join(profile, 'extensions'), { recursive: true });
fs.mkdirSync(data, { recursive: true });
const probe = http.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const prefs = {
  'extensions.zotero.useDataDir': true, 'extensions.zotero.dataDir': data,
  'extensions.zotero.sync.autoSync': false, 'extensions.zotero.sync.storage.enabled': false,
  'extensions.zotero.httpServer.enabled': true, 'extensions.zotero.httpServer.port': port,
  'extensions.zotero.httpServer.localAPI.enabled': true,
  'extensions.zotero.automaticScraperUpdates': false, 'extensions.zotero.firstRun2': false,
  'extensions.zotero.firstRunGuidance': false, 'app.update.enabled': false, 'app.update.auto': false,
  'extensions.update.enabled': false, 'extensions.autoDisableScopes': 0, 'extensions.enabledScopes': 15,
  'xpinstall.signatures.required': false, 'toolkit.telemetry.enabled': false,
  'datareporting.healthreport.uploadEnabled': false, 'browser.shell.checkDefaultBrowser': false,
  'extensions.zoteroMacWordIntegration.skipInstallation': true,
  'extensions.zoteroOpenOfficeIntegration.skipInstallation': true,
  'network.process.enabled': false, 'security.sandbox.content.level': 0,
  'extensions.logging.enabled': true,
  'extensions.zotero.debug.log': true,
};
fs.writeFileSync(path.join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'));
const records = [];
for (let index = 0; index < 3; index++) {
  const text = ['North field measured 23 units. NORTH23 is the exact evidence marker.',
    'South field measured 41 units. SOUTH41 contradicts a uniform 23-unit result.',
    'The comparison reports missing controls. No measurement of the east field exists.'][index];
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  const body = `${text}\n\nThis synthetic report documents an isolated research fixture. The observation belongs\nto the named field only. The measurement was recorded after a controlled inspection.\nThe report contains no evidence about other fields beyond its explicit statements.\nThese records are invented for software validation and do not describe real research.\nThe source identity and original page must remain attached to any retrieved evidence.`;
  page.drawText(body, { x: 40, y: 700, size: 10, lineHeight: 16, font });
  const bytes = await pdf.save();
  const file = path.join(root, 'fixtures', `source-${index + 1}.pdf`);
  fs.writeFileSync(file, bytes);
  records.push({ title: `Synthetic research source ${index + 1}`, abstract: text, file, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const output = path.join(root, 'artifacts/zotero-corpus.json');
const extensionId = 'nodus-fixture-preparer@tests.invalid';
const zip = new AdmZip();
zip.addFile('manifest.json', Buffer.from(JSON.stringify({ manifest_version: 2, name: 'Nodus isolated fixture preparer', version: '1.0',
  applications: { zotero: { id: extensionId, update_url: 'https://tests.invalid/no-update', strict_min_version: '9.0', strict_max_version: '10.*' } } })));
zip.addFile('bootstrap.js', Buffer.from(`
function install() {}
function uninstall() {}
function shutdown() {}
async function startup() {
  await Zotero.initializationPromise;
  try {
    if (Zotero.DataDirectory.dir !== ${JSON.stringify(data)}) throw new Error('unexpected_data_directory');
    await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad('item');
    const collections = [], items = [];
    for (const [index, record] of ${JSON.stringify(records)}.entries()) {
      const collection = new Zotero.Collection();
      collection.libraryID = Zotero.Libraries.userLibraryID;
      collection.name = 'Nodus synthetic collection ' + (index + 1);
      await collection.saveTx();
      collections.push({ id: collection.id, key: collection.key });
      const item = new Zotero.Item('report');
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField('title', record.title);
      item.setField('abstractNote', record.abstract);
      item.setCollections([collection.id]);
      await item.saveTx();
      const attachment = await Zotero.Attachments.importFromFile({ file: record.file, parentItemID: item.id });
      await Zotero.Fulltext.indexItems([attachment.id]);
      items.push({ id: item.id, key: item.key, version: item.version, attachment: { key: attachment.key, version: attachment.version, path: await attachment.getFilePathAsync(), sha256: record.sha256 } });
    }
    await Zotero.File.putContentsAsync(${JSON.stringify(output)}, JSON.stringify({ version: Zotero.version, dataDirectory: Zotero.DataDirectory.dir, libraryID: Zotero.Libraries.userLibraryID, collections, items }));
    Zotero.getMainWindow().document.title = 'Zotero · Nodus Research · Desarrollo';
  } catch (error) { await Zotero.File.putContentsAsync(${JSON.stringify(output)}, JSON.stringify({ error: String(error) })); }
}
`));
zip.writeZip(path.join(profile, 'extensions', `${extensionId}.xpi`));
fs.writeFileSync(path.join(root, 'isolation.sb'), policy);
const log = fs.openSync(path.join(root, 'artifacts/zotero.log'), 'w');
const child = spawn('/usr/bin/sandbox-exec', ['-f', path.join(root, 'isolation.sb'), '/Applications/Zotero.app/Contents/MacOS/zotero', '-no-remote', '-ZoteroDebugText', '-profile', profile, '-datadir', data], {
  cwd: root, env: { ...researchTestEnvironment(root), HOME: root, MOZ_NO_REMOTE: '1', MOZ_DISABLE_CONTENT_SANDBOX: '1',
    MOZ_DISABLE_SOCKET_PROCESS_SANDBOX: '1', MOZ_DISABLE_RDD_SANDBOX: '1', MOZ_DISABLE_GMP_SANDBOX: '1', MOZ_DISABLE_GPU_SANDBOX: '1' }, stdio: ['ignore', log, log],
});
const report = { root, profile, data, proof, pid: child.pid, endpoint: `http://127.0.0.1:${port}/api`, passed: false };
try {
  const deadline = Date.now() + 55000;
  while (!fs.existsSync(output) && Date.now() < deadline && child.exitCode === null) await new Promise(resolve => setTimeout(resolve, 250));
  if (!fs.existsSync(output)) throw new Error(`Zotero fixture preparation did not finish; inspect ${root}/artifacts/zotero.log`);
  const corpus = JSON.parse(fs.readFileSync(output, 'utf8'));
  if (corpus.error) throw new Error(corpus.error);
  const response = await fetch(`${report.endpoint}/users/0/items/${corpus.items[0].key}`, { headers: { 'Zotero-Allowed-Request': '1', 'Zotero-API-Version': '3' }, signal: AbortSignal.timeout(10000) });
  const firstItem = await response.json();
  if (!response.ok || firstItem.key !== corpus.items[0].key) throw new Error('Independent Zotero API identity mismatch');
  const serverId = response.headers.get('Zotero-Server-ID');
  assert.ok(serverId);
  const attachmentResponse = await fetch(`${report.endpoint}/users/0/items/${corpus.items[0].attachment.key}`, { signal: AbortSignal.timeout(10000) });
  const attachmentItem = await attachmentResponse.json();
  const scopeFile = path.join(root, 'mcp/scope.json');
  fs.writeFileSync(scopeFile, JSON.stringify({ format: 'nodus.zotero-mcp-scope/1', root, endpoint: report.endpoint, serverId,
    items: [{ libraryType: 'user', libraryId: '0', itemKey: firstItem.key, version: firstItem.version, revision: corpus.items[0].attachment.sha256,
      attachments: [{ ...corpus.items[0].attachment, version: attachmentItem.version }] }] }));
  const runtime = path.resolve(import.meta.dirname, '../build/zotero-mcp');
  const transport = new StdioClientTransport({ command: '/usr/bin/sandbox-exec', args: ['-p', policy, path.join(runtime, 'python/bin/python3'), '-I', '-B', path.join(runtime, 'serve.py'), scopeFile],
    env: { ...researchTestEnvironment(root), HOME: root, XDG_CACHE_HOME: path.join(root, 'mcp/cache'), XDG_CONFIG_HOME: path.join(root, 'mcp/config') }, stderr: 'pipe' });
  const client = new Client({ name: 'nodus-real-zotero-test', version: '1' });
  try {
    await client.connect(transport, { timeout: 15000 });
    const args = { library_type: 'user', library_id: '0', item_key: firstItem.key };
    assert.equal((await client.callTool({ name: 'zotero_get_item_metadata', arguments: args })).isError, false);
    const pages = await client.callTool({ name: 'zotero_read_pdf_pages', arguments: { ...args, attachment_key: attachmentItem.key, start_page: 1, end_page: 1 } });
    assert.equal(pages.isError, false, JSON.stringify(pages));
    assert.match(JSON.stringify(pages), /NORTH23/);
    assert.equal((await client.callTool({ name: 'zotero_get_item_metadata', arguments: { ...args, item_key: corpus.items[1].key } })).isError, true);
    Object.assign(report, { mcp: { version: client.getServerVersion(), transport: 'stdio', physicalPage: 1, evidenceMarker: 'NORTH23', unauthorizedSourceRejected: true } });
  } finally { await client.close(); }
  if (process.argv.includes('--nodus') || providerProxy) {
    const { verifyZoteroNodusProduct } = await import('./verify-zotero-nodus-product.mjs');
    report.nodus = await verifyZoteroNodusProduct(root, report.endpoint, corpus, { providerProxy: providerProxy?.url });
  }
  Object.assign(report, { passed: true, zoteroVersion: corpus.version, sources: corpus.items.length });
} finally {
  if (providerProxy) { report.accounting = providerProxy.ledger.read(); await providerProxy.close(); }
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.closeSync(log);
  fs.writeFileSync(path.join(root, 'artifacts/zotero-startup.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ root, passed: report.passed, proof, zoteroVersion: report.zoteroVersion,
    mcp: report.mcp, nodusPassed: report.nodus?.passed, liveChecks: report.nodus?.live?.checks.map(check => ({
      name: check.name, expectedAnswer: check.expectedAnswer, citationsExist: check.citationsExist, knownEvidenceRetrieved: check.knownEvidenceRetrieved })),
    calls: report.accounting?.calls.length, accountedUsd: report.accounting?.calls.reduce((sum, call) => sum + (call.actualUsd ?? call.maximumUsd), 0) }));
}
