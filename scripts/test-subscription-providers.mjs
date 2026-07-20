import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-subscription-providers-'));
const bundle = path.join(outDir, 'subscription-providers.cjs');
const entry = path.join(outDir, 'entry.ts');
fs.writeFileSync(entry, [
  `export * from ${JSON.stringify(path.join(repoRoot, 'electron/ai/openCodeGoCompletion.ts'))};`,
  `export * from ${JSON.stringify(path.join(repoRoot, 'electron/ai/openCodeGoPricing.ts'))};`,
  `export * from ${JSON.stringify(path.join(repoRoot, 'electron/ai/githubCopilotCompletion.ts'))};`,
].join('\n'));
execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=es2022',
  `--outfile=${bundle}`,
], { cwd: repoRoot, stdio: 'inherit' });
const require = createRequire(import.meta.url);
const {
  completeWithOpenCodeGo,
  estimateOpenCodeGoCostUsd,
  openCodeGoProtocol,
  runIsolatedGitHubCopilotCompletion,
} = require(bundle);

test.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

test('redistributed official runtimes retain the required license notices', () => {
  const notices = fs.readFileSync(path.join(repoRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const remoteManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'legal/remote-notices.json'), 'utf8'));
  const copilotCliLicense = fs.readFileSync(path.join(repoRoot, 'node_modules/@github/copilot/LICENSE.md'), 'utf8');
  assert.match(notices, /GitHub Copilot SDK .*MIT License/);
  assert.match(notices, /OpenAI Codex CLI .*Apache License 2\.0/);
  const pinned = new Set(remoteManifest.files.map((entry) => entry.destination));
  assert.ok(pinned.has('GITHUB_COPILOT_SDK_LICENSE.txt'));
  assert.ok(pinned.has('OPENAI_CODEX_LICENSE.txt'));
  assert.ok(pinned.has('GITHUB_COPILOT_CLI_LICENSE.md'));
  assert.match(copilotCliLicense, /right to reproduce and redistribute unmodified copies/);
});

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function fakeOpenCodeGo() {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    const payload = await body(request);
    calls.push({ url: request.url, headers: request.headers, payload });
    if (request.headers.authorization === 'Bearer rejected') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ type: 'error', error: { type: 'AuthError', message: 'Invalid API key.' } }));
      return;
    }
    if (request.url === '/v1/chat/completions') {
      if (!payload.stream) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          choices: [{ message: { content: 'respuesta openai' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 3 } },
        }));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'piensa' } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hola ' } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'go' }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 2 } })}\n\n`);
      response.end('data: [DONE]\n\n');
      return;
    }
    if (request.url === '/v1/messages') {
      if (!payload.stream) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          content: [{ type: 'text', text: 'respuesta anthropic' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 7, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 },
        }));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 6, cache_read_input_tokens: 2 } } })}\n\n`);
      response.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hola mini' } })}\n\n`);
      response.end(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } })}\n\n`);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('OpenCode Go selects its two documented protocols and normalizes usage', async () => {
  const fake = await fakeOpenCodeGo();
  try {
    assert.equal(openCodeGoProtocol('kimi-k3'), 'openai');
    assert.equal(openCodeGoProtocol('minimax-m3'), 'anthropic');
    assert.equal(openCodeGoProtocol('qwen3.7-plus'), 'anthropic');

    const openai = await completeWithOpenCodeGo({
      apiKey: 'go-key', model: 'kimi-k3', system: 'system', user: 'user', jsonMode: true, baseUrl: fake.baseUrl,
    });
    assert.equal(openai.text, 'respuesta openai');
    assert.deepEqual(openai.usage, { uncachedInputTokens: 7, outputTokens: 4, cachedReadTokens: 3, cachedWriteTokens: 0 });
    const openaiCall = fake.calls[0];
    assert.equal(openaiCall.url, '/v1/chat/completions');
    assert.equal(openaiCall.headers.authorization, 'Bearer go-key');
    assert.deepEqual(openaiCall.payload.response_format, { type: 'json_object' });

    const anthropic = await completeWithOpenCodeGo({
      apiKey: 'go-key', model: 'minimax-m3', system: 'system', user: 'user', jsonMode: true, baseUrl: fake.baseUrl,
    });
    assert.equal(anthropic.text, 'respuesta anthropic');
    assert.deepEqual(anthropic.usage, { uncachedInputTokens: 7, outputTokens: 5, cachedReadTokens: 2, cachedWriteTokens: 1 });
    const anthropicCall = fake.calls[1];
    assert.equal(anthropicCall.url, '/v1/messages');
    assert.equal(anthropicCall.headers['x-api-key'], 'go-key');
    assert.equal(anthropicCall.headers['anthropic-version'], '2023-06-01');
  } finally {
    await fake.close();
  }
});

test('OpenCode Go local metering uses official cache and long-context prices without guessing', () => {
  assert.equal(estimateOpenCodeGoCostUsd('qwen3.7-plus', {
    uncachedInputTokens: 100_000, outputTokens: 10_000, cachedReadTokens: 0, cachedWriteTokens: 0,
  }), 0.056);
  assert.equal(estimateOpenCodeGoCostUsd('qwen3.7-plus', {
    uncachedInputTokens: 300_000, outputTokens: 10_000, cachedReadTokens: 0, cachedWriteTokens: 0,
  }), 0.408);
  assert.equal(estimateOpenCodeGoCostUsd('future-unpriced-model', {
    uncachedInputTokens: 1, outputTokens: 1, cachedReadTokens: 0, cachedWriteTokens: 0,
  }), null);
});

test('OpenCode Go streams both protocols, separates reasoning, and surfaces auth errors', async () => {
  const fake = await fakeOpenCodeGo();
  try {
    const text = [];
    const reasoning = [];
    const openai = await completeWithOpenCodeGo({
      apiKey: 'go-key', model: 'kimi-k3', system: 's', user: 'u', baseUrl: fake.baseUrl,
      onDelta: (delta) => text.push(delta), onReasoningDelta: (delta) => reasoning.push(delta),
    });
    assert.equal(openai.text, 'hola go');
    assert.deepEqual(text, ['hola ', 'go']);
    assert.deepEqual(reasoning, ['piensa']);

    const mini = [];
    const anthropic = await completeWithOpenCodeGo({
      apiKey: 'go-key', model: 'minimax-m3', system: 's', user: 'u', baseUrl: fake.baseUrl,
      onDelta: (delta) => mini.push(delta),
    });
    assert.equal(anthropic.text, 'hola mini');
    assert.deepEqual(mini, ['hola mini']);
    assert.deepEqual(anthropic.usage, { uncachedInputTokens: 6, outputTokens: 3, cachedReadTokens: 2, cachedWriteTokens: 0 });

    await assert.rejects(() => completeWithOpenCodeGo({
      apiKey: 'rejected', model: 'kimi-k3', system: 's', user: 'u', baseUrl: fake.baseUrl,
    }), (error) => error.status === 401 && /Invalid API key/i.test(error.message));
  } finally {
    await fake.close();
  }
});

class FakeCopilotSession {
  sessionId = 'ephemeral-session';
  handlers = new Set();
  aborted = false;
  disconnected = false;
  rpc = { usage: { getMetrics: async () => ({
    currentModel: 'gpt-test', totalPremiumRequestCost: 0.5, totalUserRequests: 1,
    lastCallInputTokens: 12, lastCallOutputTokens: 4,
  }) } };
  on(handler) { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  async sendAndWait(options) {
    this.message = options;
    for (const handler of this.handlers) handler({ type: 'assistant.message_delta', data: { deltaContent: 'hola ' } });
    for (const handler of this.handlers) handler({ type: 'assistant.message_delta', data: { deltaContent: 'copilot' } });
    return { data: { content: 'hola copilot' } };
  }
  async abort() { this.aborted = true; }
  async disconnect() { this.disconnected = true; }
}

class FakeCopilotClient {
  session = new FakeCopilotSession();
  deleted = [];
  async createSession(config) { this.config = config; return this.session; }
  async deleteSession(id) { this.deleted.push(id); }
}

test('GitHub Copilot completion is ephemeral, no-tools, multimodal, streamable, and metered', async () => {
  const client = new FakeCopilotClient();
  const deltas = [];
  const result = await runIsolatedGitHubCopilotCompletion(client, {
    model: 'gpt-test', system: 'Return only text.', user: 'hello', reasoning: 'high', supportsReasoning: true,
    workdir: outDir, images: [{ mediaType: 'image/png', base64: Buffer.from('image').toString('base64') }],
    onDelta: (delta) => deltas.push(delta),
  });
  assert.equal(result.text, 'hola copilot');
  assert.deepEqual(deltas, ['hola ', 'copilot']);
  assert.deepEqual(result.usage, { model: 'gpt-test', premiumRequestCost: 0.5, userRequests: 1, inputTokens: 12, outputTokens: 4 });
  assert.equal(client.config.model, 'gpt-test');
  assert.equal(client.config.reasoningEffort, 'high');
  assert.deepEqual(client.config.availableTools, []);
  assert.deepEqual(client.config.tools, []);
  assert.deepEqual(client.config.mcpServers, {});
  assert.equal(client.config.enableConfigDiscovery, false);
  assert.equal(client.config.enableSkills, false);
  assert.equal(client.config.enableHostGitOperations, false);
  assert.equal(client.config.enableSessionStore, false);
  assert.equal(client.config.remoteSession, 'off');
  assert.equal(client.config.enableSessionTelemetry, false);
  assert.deepEqual(client.config.onPermissionRequest(), { kind: 'reject', feedback: 'Nodus does not expose tools for text generation.' });
  assert.match(client.config.systemMessage.content, /Never use tools, shell commands, files, URLs, MCP servers/);
  assert.equal(client.session.message.attachments[0].type, 'blob');
  assert.equal(client.session.message.attachments[0].data, Buffer.from('image').toString('base64'));
  assert.equal(client.session.disconnected, true);
  assert.deepEqual(client.deleted, ['ephemeral-session']);
});

test('GitHub Copilot aborts and rejects any unexpected tool execution', async () => {
  const client = new FakeCopilotClient();
  client.session.sendAndWait = async function () {
    for (const handler of this.handlers) handler({ type: 'tool.execution_start', data: { toolName: 'shell' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { data: { content: 'must not escape' } };
  };
  await assert.rejects(() => runIsolatedGitHubCopilotCompletion(client, {
    model: 'gpt-test', system: 's', user: 'u', reasoning: 'off', supportsReasoning: false, workdir: outDir,
  }), /herramienta deshabilitada/i);
  assert.equal(client.session.aborted, true);
  assert.equal(client.session.disconnected, true);
  assert.deepEqual(client.deleted, ['ephemeral-session']);
});
