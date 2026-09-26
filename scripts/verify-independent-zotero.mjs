/** Disposable Zotero fixture preparer. Never used by the Research connector. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createResearchTestRoot, macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';
import { launchIndependentZotero } from './lib/independent-zotero.mjs';

const root = createResearchTestRoot();
const baselineWorkspace = process.argv.find(argument => argument.startsWith('--baseline-workspace='))?.slice('--baseline-workspace='.length);
const sourceCorpusRoot = process.argv.find(argument => argument.startsWith('--corpus-root='))?.slice('--corpus-root='.length);
if (baselineWorkspace) {
  const manifest = JSON.parse(fs.readFileSync(path.join(baselineWorkspace, '../artifacts/baseline.json'), 'utf8'));
  if (manifest.base !== 'f54995e7' || manifest.exitCode !== 0 || manifest.workspace !== fs.realpathSync(baselineWorkspace)) throw new Error('Unverified baseline build');
}
// Verify a deny-all boundary before fixture/credential preparation.
verifyResearchSandbox(root);
let providerProxy;
// --pin-window: a simulated model behind the real proxy, steered by the scenario.
const simulatedControl = { behaviour: null };
if (process.argv.includes('--pin-window')) {
  const { simulatedUpstream } = await import('./lib/research-app-harness.mjs');
  const { startResearchProviderProxy } = await import('./research-provider-proxy.mjs');
  providerProxy = await startResearchProviderProxy(root, { dispatch: simulatedUpstream((...args) => simulatedControl.behaviour?.(...args) ?? null).dispatch });
} else if (process.argv.includes('--live')) {
  const campaignRoot = process.argv.find(argument => argument.startsWith('--campaign-root='))?.slice('--campaign-root='.length);
  if (!campaignRoot) throw new Error('Live runs require the same explicit --campaign-root for the entire $5 campaign');
  const { startResearchProviderProxy } = await import('./research-provider-proxy.mjs');
  providerProxy = await startResearchProviderProxy(campaignRoot);
  const { importResearchTestCredentials } = await import('./research-test-credentials.mjs');
  try { importResearchTestCredentials(root, process.argv.find(argument => argument.startsWith('--credentials-root='))?.slice('--credentials-root='.length)); } catch (error) { await providerProxy.close(); throw error; }
}
const probe = http.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const externalMcpPort = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const allowedPorts = [port, externalMcpPort, ...(providerProxy ? [Number(new URL(providerProxy.url).port)] : [])];
const policy = macResearchSandbox(root, allowedPorts);
const proof = { ...verifyResearchSandbox(root, policy), allowedLoopbackPorts: allowedPorts };
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
  const bytes = sourceCorpusRoot ? fs.readFileSync(path.join(sourceCorpusRoot, 'fixtures', `source-${index + 1}.pdf`)) : await pdf.save();
  const file = path.join(root, 'fixtures', `source-${index + 1}.pdf`);
  fs.writeFileSync(file, bytes);
  records.push({ title: `Synthetic research source ${index + 1}`, abstract: text, file, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const report = { root, profile: path.join(root, 'zotero/profile'), data: path.join(root, 'zotero/data'), proof, endpoint: `http://127.0.0.1:${port}/api`, passed: false };
let zotero;
try {
  zotero = await launchIndependentZotero({ root, port, policy, records });
  const { corpus } = zotero;
  report.pid = zotero.child.pid;
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
  const mcpLog = fs.createWriteStream(path.join(root, 'artifacts/fixture-mcp.log'));
  transport.stderr?.pipe(mcpLog);
  try {
    await client.connect(transport, { timeout: 60000 });
    const args = { library_type: 'user', library_id: '0', item_key: firstItem.key };
    assert.equal((await client.callTool({ name: 'zotero_get_item_metadata', arguments: args })).isError, false);
    const pages = await client.callTool({ name: 'zotero_read_pdf_pages', arguments: { ...args, attachment_key: attachmentItem.key, start_page: 1, end_page: 1 } });
    assert.equal(pages.isError, false, JSON.stringify(pages));
    assert.match(JSON.stringify(pages), /NORTH23/);
    assert.equal((await client.callTool({ name: 'zotero_get_item_metadata', arguments: { ...args, item_key: corpus.items[1].key } })).isError, true);
    Object.assign(report, { mcp: { version: client.getServerVersion(), transport: 'stdio', physicalPage: 1, evidenceMarker: 'NORTH23', unauthorizedSourceRejected: true } });
  } finally { await client.close(); mcpLog.end(); }
  if (process.argv.includes('--nodus') || providerProxy) {
    const { verifyZoteroNodusProduct } = await import('./verify-zotero-nodus-product.mjs');
    report.nodus = await verifyZoteroNodusProduct(root, report.endpoint, corpus, { providerProxy: providerProxy?.url, simulatedControl: process.argv.includes('--pin-window') ? simulatedControl : null, externalMcpPort, baselineWorkspace, chatOnly: process.argv.includes('--chat-only'), adversarial: process.argv.includes('--adversarial') });
  }
  Object.assign(report, { passed: true, zoteroVersion: corpus.version, sources: corpus.items.length });
} finally {
  if (providerProxy) { report.accounting = providerProxy.ledger.read(); await providerProxy.close(); }
  await zotero?.stop();
  fs.writeFileSync(path.join(root, 'artifacts/zotero-startup.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ root, passed: report.passed, proof, zoteroVersion: report.zoteroVersion,
    mcp: report.mcp, nodusPassed: report.nodus?.passed, liveChecks: report.nodus?.live?.checks.map(check => ({
      name: check.name, expectedAnswer: check.expectedAnswer, citationsExist: check.citationsExist, knownEvidenceRetrieved: check.knownEvidenceRetrieved })),
    calls: report.accounting?.calls.length, accountedUsd: report.accounting?.calls.reduce((sum, call) => sum + (call.actualUsd ?? call.maximumUsd), 0) }));
}
