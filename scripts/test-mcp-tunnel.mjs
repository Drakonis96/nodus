import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'nodus-mcp-tunnel-test-'));
const bundle = path.join(temporary, 'mcpTunnel.cjs');
execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  path.join(repoRoot, 'shared/mcpTunnel.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
], { cwd: repoRoot, stdio: 'inherit' });
const require = createRequire(import.meta.url);
const helpers = require(bundle);

test.after(() => rm(temporary, { recursive: true, force: true }));

test('OpenAI tunnel IDs are accepted only in the documented form', () => {
  assert.equal(helpers.isValidMcpTunnelId('tunnel_0123456789abcdef0123456789abcdef'), true);
  assert.equal(helpers.isValidMcpTunnelId(' tunnel_0123456789abcdef0123456789abcdef '), true);
  assert.equal(helpers.isValidMcpTunnelId('tunnel_0123456789ABCDEF0123456789ABCDEF'), false);
  assert.equal(helpers.isValidMcpTunnelId('tunnel_../../runtime'), false);
  assert.equal(helpers.isValidMcpTunnelId('tunnel_short'), false);
});

test('every supported desktop target selects the exact official release asset', () => {
  const tag = 'v0.0.10';
  assert.equal(helpers.mcpTunnelAssetName(tag, 'darwin', 'arm64'), 'tunnel-client-v0.0.10-darwin-arm64.zip');
  assert.equal(helpers.mcpTunnelAssetName(tag, 'darwin', 'x64'), 'tunnel-client-v0.0.10-darwin-amd64.zip');
  assert.equal(helpers.mcpTunnelAssetName(tag, 'linux', 'arm64'), 'tunnel-client-v0.0.10-linux-arm64.zip');
  assert.equal(helpers.mcpTunnelAssetName(tag, 'linux', 'x64'), 'tunnel-client-v0.0.10-linux-amd64.zip');
  assert.equal(helpers.mcpTunnelAssetName(tag, 'win32', 'arm64'), 'tunnel-client-v0.0.10-windows-arm64.zip');
  assert.equal(helpers.mcpTunnelAssetName(tag, 'win32', 'x64'), 'tunnel-client-v0.0.10-windows-amd64.zip');
  assert.equal(helpers.mcpTunnelAssetName(tag, 'freebsd', 'x64'), null);
  assert.equal(helpers.mcpTunnelAssetName(tag, 'linux', 'ia32'), null);
});

test('operator failures become stable, user-facing categories', () => {
  assert.equal(helpers.classifyMcpTunnelFailure('HTTP 401 unauthorized: incorrect API key'), 'api_key_rejected');
  assert.equal(helpers.classifyMcpTunnelFailure('403 forbidden: Tunnels Read + Use permission required'), 'permission_denied');
  assert.equal(helpers.classifyMcpTunnelFailure('403 permission denied by the OpenAI Platform'), 'permission_denied');
  assert.equal(helpers.classifyMcpTunnelFailure('tunnel not found (404)'), 'tunnel_not_found');
  assert.equal(helpers.classifyMcpTunnelFailure('MCP probe to 127.0.0.1 refused'), 'local_server');
  assert.equal(helpers.classifyMcpTunnelFailure('TLS certificate error contacting proxy'), 'network');
  assert.equal(helpers.classifyMcpTunnelFailure('SHA-256 checksum mismatch'), 'integrity_failed');
});

test('the integration keeps both credentials out of argv and renderer status', async () => {
  const [tunnel, types] = await Promise.all([
    readFile(path.join(repoRoot, 'electron/mcp/tunnel.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'shared/types.ts'), 'utf8'),
  ]);
  assert.match(tunnel, /CONTROL_PLANE_API_KEY:\s*apiKey/);
  assert.match(tunnel, /NODUS_MCP_AUTHORIZATION:\s*`Bearer \$\{settings\.mcpToken\}`/);
  assert.match(tunnel, /spawn\(runtime\.executable, \['run'\]/);
  assert.doesNotMatch(tunnel, /\['run'[^\]]*(?:apiKey|mcpToken)/);
  const statusBlock = types.slice(types.indexOf('export interface McpTunnelStatus'), types.indexOf('export interface McpTunnelConnectInput'));
  assert.doesNotMatch(statusBlock, /\b(?:apiKey|mcpToken|bearerToken)\s*:/i);
});

test('the downloaded executable is installed only after SHA-256 verification', async () => {
  const tunnel = await readFile(path.join(repoRoot, 'electron/mcp/tunnel.ts'), 'utf8');
  const digestCheck = tunnel.indexOf("if (actual !== expectedSha256)");
  const executableWrite = tunnel.indexOf('fsp.writeFile(temporaryExecutable');
  assert.ok(digestCheck > 0 && executableWrite > digestCheck);
  assert.match(tunnel, /hostname === 'github\.com'/);
  assert.match(tunnel, /pathname\.startsWith\('\/openai\/tunnel-client\/releases\/download\/'\)/);
  assert.match(tunnel, /path\.resolve\(parsed\.executable\) !== path\.resolve\(expected\)/);
});
