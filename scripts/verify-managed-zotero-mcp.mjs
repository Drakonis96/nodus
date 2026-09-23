import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createResearchTestRoot, macResearchSandbox, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';

const root = createResearchTestRoot();
const policy = macResearchSandbox(root);
const isolation = verifyResearchSandbox(root, policy);
const calls = [];
let version = 3;
const fixture = http.createServer((request, response) => {
  calls.push({ method: request.method, url: request.url });
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Zotero-Server-ID', 'synthetic-server');
  const key = request.url.split('/')[5];
  response.end(JSON.stringify(request.url.endsWith('/fulltext')
    ? { content: 'Synthetic evidence: the north field measured 23 units.' }
    : { key, version, data: { key, version, title: 'Synthetic source' } }));
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const scope = { format: 'nodus.zotero-mcp-scope/1', root,
  serverId: 'synthetic-server',
  endpoint: `http://127.0.0.1:${fixture.address().port}/api`,
  items: [{ libraryType: 'user', libraryId: '0', itemKey: 'SOURCE01', version: 3, revision: 'synthetic-v3',
    attachments: [{ key: 'ATTACH01', version: 3 }] }] };
const manifest = path.join(root, 'mcp/scope.json');
fs.writeFileSync(manifest, JSON.stringify(scope));
const runtime = path.resolve(import.meta.dirname, '../build/zotero-mcp');
const transport = new StdioClientTransport({ command: '/usr/bin/sandbox-exec', args: ['-p', policy,
  path.join(runtime, 'python/bin/python3'), '-I', '-B', path.join(runtime, 'serve.py'), manifest],
  env: { ...researchTestEnvironment(root), HOME: root, XDG_CACHE_HOME: path.join(root, 'mcp/cache'),
    XDG_CONFIG_HOME: path.join(root, 'mcp/config'), FASTMCP_CHECK_FOR_UPDATES: 'off' }, stderr: 'pipe' });
const client = new Client({ name: 'nodus-scoped-integration-test', version: '1' });
let diagnostic = '';
transport.stderr?.on('data', data => { diagnostic += data.toString(); });
const report = { root, isolation, endpointKind: 'synthetic-http-fixture', transport: 'stdio', passed: false };
try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map(tool => tool.name).sort();
  assert.deepEqual(tools, ['zotero_get_item_children', 'zotero_get_item_fulltext', 'zotero_get_item_metadata', 'zotero_read_pdf_pages']);
  const args = { library_type: 'user', library_id: '0', item_key: 'SOURCE01' };
  const invoke = (name, extra = {}) => client.callTool({ name, arguments: { ...args, ...extra } });
  assert.equal((await invoke('zotero_get_item_metadata')).isError, false);
  assert.equal((await invoke('zotero_get_item_children')).isError, false);
  assert.equal((await invoke('zotero_get_item_fulltext', { attachment_key: 'ATTACH01' })).isError, false);
  const beforeDenied = calls.length;
  for (const override of [{ item_key: 'OUTSIDE1' }, { library_id: '2' }, { library_type: 'group' }]) {
    assert.equal((await invoke('zotero_get_item_metadata', override)).isError, true);
  }
  assert.equal((await invoke('zotero_get_item_fulltext', { attachment_key: 'OUTSIDE2' })).isError, true);
  assert.equal((await invoke('zotero_read_pdf_pages', { attachment_key: 'ATTACH01', start_page: 1, end_page: 99 })).isError, true);
  assert.equal(calls.length, beforeDenied, 'rejected identities never reach Zotero');
  version = 4;
  assert.equal((await invoke('zotero_get_item_metadata')).isError, true, 'revision changes stop access');
  assert.ok(calls.every(call => call.method === 'GET' && /^\/api\/users\/0\/items\/(SOURCE01|ATTACH01)(\/fulltext)?$/.test(call.url)));
  Object.assign(report, { passed: true, tools, calls, version: client.getServerVersion() });
} catch (error) {
  console.error(diagnostic);
  throw error;
} finally {
  await client.close();
  await new Promise(resolve => fixture.close(resolve));
  fs.writeFileSync(path.join(root, 'artifacts/managed-mcp.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
