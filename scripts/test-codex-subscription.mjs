import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-codex-test-'));
const bundle = path.join(outDir, 'codex-test.cjs');
const entry = path.join(outDir, 'entry.ts');
fs.writeFileSync(entry, [
  `export { CodexAppServerClient } from ${JSON.stringify(path.join(repoRoot, 'electron/ai/codexAppServerClient.ts'))};`,
  `export { resolveCodexReasoningEffort, runIsolatedCodexCompletion } from ${JSON.stringify(path.join(repoRoot, 'electron/ai/codexCompletion.ts'))};`,
  `export { runIsolatedCodexImage } from ${JSON.stringify(path.join(repoRoot, 'electron/ai/codexImage.ts'))};`,
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
  CodexAppServerClient,
  resolveCodexReasoningEffort,
  runIsolatedCodexCompletion,
  runIsolatedCodexImage,
} = require(bundle);

test.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

function fakeAppServer() {
  const file = path.join(outDir, 'fake-codex.mjs');
  fs.writeFileSync(file, `#!/usr/bin/env node
import readline from 'node:readline';
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const reply = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + '\\n');
for await (const line of lines) {
  const msg = JSON.parse(line);
  if (msg.method === 'initialized') continue;
  if (msg.method === 'initialize') {
    reply(msg.id, { serverInfo: { name: 'fake', version: '1' } });
  } else if (msg.method === 'probe') {
    reply(msg.id, {
      argv: process.argv.slice(2),
      codexHome: process.env.CODEX_HOME,
      secrets: {
        openai: process.env.OPENAI_API_KEY ?? null,
        codex: process.env.CODEX_API_KEY ?? null,
        access: process.env.CODEX_ACCESS_TOKEN ?? null,
        azure: process.env.AZURE_OPENAI_API_KEY ?? null,
        base: process.env.OPENAI_BASE_URL ?? null,
        github: process.env.GITHUB_TOKEN ?? null,
      },
    });
  } else if (msg.method === 'emit') {
    reply(msg.id, {});
    process.stdout.write(JSON.stringify({ method: 'account/updated', params: { authMode: 'chatgpt' } }) + '\\n');
  }
}`);
  fs.chmodSync(file, 0o755);
  return file;
}

test('Codex App Server is forced to managed ChatGPT auth and receives no ambient API credentials', async () => {
  const home = path.join(outDir, 'codex-home');
  fs.mkdirSync(home);
  const client = new CodexAppServerClient({
    binaryPath: fakeAppServer(),
    codexHome: home,
    appVersion: 'test',
    env: {
      ...process.env,
      OPENAI_API_KEY: 'sk-openai-secret',
      CODEX_API_KEY: 'codex-secret',
      CODEX_ACCESS_TOKEN: 'access-secret',
      AZURE_OPENAI_API_KEY: 'azure-secret',
      OPENAI_BASE_URL: 'https://attacker.invalid',
      GITHUB_TOKEN: 'github-secret',
    },
  });
  try {
    const probe = await client.request('probe');
    assert.deepEqual(probe.secrets, { openai: null, codex: null, access: null, azure: null, base: null, github: null });
    assert.equal(probe.codexHome, home);
    assert.deepEqual(probe.argv, [
      '--config', 'forced_login_method="chatgpt"',
      '--config', 'cli_auth_credentials_store="keyring"',
      '--config', 'model_provider="openai"',
      '--config', 'web_search="disabled"',
      '--config', 'mcp_servers={}',
      '--config', 'features.apps=false',
      '--config', 'features.browser_use=false',
      '--config', 'features.code_mode_host=false',
      '--config', 'features.computer_use=false',
      '--config', 'features.goals=false',
      '--config', 'features.hooks=false',
      '--config', 'features.image_generation=false',
      '--config', 'features.in_app_browser=false',
      '--config', 'features.multi_agent=false',
      '--config', 'features.plugins=false',
      '--config', 'features.shell_tool=false',
      '--config', 'features.tool_suggest=false',
      '--config', 'features.unified_exec=false',
      '--config', 'features.workspace_dependencies=false',
      'app-server', '--listen', 'stdio://',
    ]);

    const notification = new Promise((resolve) => {
      const off = client.onNotification((method, params) => {
        if (method === 'account/updated') {
          off();
          resolve(params);
        }
      });
    });
    await client.request('emit');
    assert.deepEqual(await notification, { authMode: 'chatgpt' });
  } finally {
    await client.stop();
  }
});

class CompletionTransport {
  handlers = new Set();
  calls = [];
  request(method, params) {
    this.calls.push({ method, params });
    if (method === 'thread/start') return Promise.resolve({ thread: { id: 'thread-1' } });
    if (method === 'turn/start') {
      setTimeout(() => {
        for (const handler of this.handlers) {
          handler('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', delta: 'Hola ' });
          handler('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', delta: 'mundo' });
          handler('turn/completed', {
            threadId: 'thread-1',
            turn: { status: 'completed', items: [{ type: 'agentMessage', text: 'Hola mundo' }] },
          });
        }
      }, 0);
      return Promise.resolve({ turn: { id: 'turn-1' } });
    }
    return Promise.resolve({});
  }
  onNotification(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

test('Nodus completions are ephemeral, read-only, tool-isolated, streamable and multimodal', async () => {
  const workdir = fs.mkdtempSync(path.join(outDir, 'completion-'));
  const runtime = new CompletionTransport();
  const deltas = [];
  try {
    const answer = await runIsolatedCodexCompletion(runtime, {
      model: 'gpt-test',
      system: 'Devuelve solo la respuesta.',
      user: 'Saluda.',
      reasoning: 'xhigh',
      workdir,
      images: [{ mediaType: 'image/png', base64: Buffer.from('image-bytes').toString('base64') }],
      onDelta: (delta) => deltas.push(delta),
    });
    assert.equal(answer, 'Hola mundo');
    assert.deepEqual(deltas, ['Hola ', 'mundo']);

    const thread = runtime.calls.find((call) => call.method === 'thread/start').params;
    assert.equal(thread.modelProvider, 'openai');
    assert.equal(thread.approvalPolicy, 'never');
    assert.equal(thread.sandbox, 'read-only');
    assert.equal(thread.ephemeral, true);
    assert.equal(thread.config.web_search, 'disabled');
    assert.deepEqual(thread.config.mcp_servers, {});
    assert.ok(Object.values(thread.config.features).every((enabled) => enabled === false));
    assert.equal(thread.cwd, workdir);
    assert.equal(thread.developerInstructions, 'Devuelve solo la respuesta.');
    assert.match(thread.baseInstructions, /Never invoke shell commands, tools, MCP servers, plugins/);

    const turn = runtime.calls.find((call) => call.method === 'turn/start').params;
    assert.equal(turn.approvalPolicy, 'never');
    assert.deepEqual(turn.sandboxPolicy, { type: 'readOnly', networkAccess: false });
    assert.equal(turn.effort, 'xhigh');
    assert.equal(turn.summary, 'none');
    assert.deepEqual(turn.input[0], { type: 'text', text: 'Saluda.', text_elements: [] });
    assert.equal(turn.input[1].type, 'localImage');
    assert.equal(path.dirname(turn.input[1].path), workdir);
    assert.equal(fs.readFileSync(turn.input[1].path, 'utf8'), 'image-bytes');
    if (process.platform !== 'win32') assert.equal(fs.statSync(turn.input[1].path).mode & 0o777, 0o600);
    assert.ok(runtime.calls.some((call) => call.method === 'thread/unsubscribe'));
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('Codex reasoning follows each model catalog and safely handles stale choices', () => {
  const model = {
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'minimal', description: 'Fastest' },
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'xhigh', description: 'Deepest' },
      { reasoningEffort: 'ultra', description: 'Maximum current catalog setting' },
    ],
  };
  assert.equal(resolveCodexReasoningEffort(model, 'minimal'), 'minimal');
  assert.equal(resolveCodexReasoningEffort(model, 'xhigh'), 'xhigh');
  assert.equal(resolveCodexReasoningEffort(model, 'ultra'), 'ultra');
  assert.equal(resolveCodexReasoningEffort(model, 'off'), 'minimal');
  assert.equal(resolveCodexReasoningEffort(model, 'max'), null, 'a removed catalog option falls back to the model default');
  assert.equal(resolveCodexReasoningEffort(model, null), null, 'no override leaves Codex on its advertised default');
});

test('an aborted Codex completion interrupts its exact turn and returns safely', async () => {
  const workdir = fs.mkdtempSync(path.join(outDir, 'abort-'));
  const controller = new AbortController();
  const runtime = new CompletionTransport();
  runtime.request = function (method, params) {
    this.calls.push({ method, params });
    if (method === 'thread/start') return Promise.resolve({ thread: { id: 'thread-1' } });
    if (method === 'turn/start') {
      setTimeout(() => controller.abort(), 0);
      return Promise.resolve({ turn: { id: 'turn-1' } });
    }
    if (method === 'turn/interrupt') {
      setTimeout(() => {
        for (const handler of this.handlers) {
          handler('turn/completed', { threadId: 'thread-1', turn: { status: 'interrupted', items: [] } });
        }
      }, 0);
    }
    return Promise.resolve({});
  };
  try {
    assert.equal(await runIsolatedCodexCompletion(runtime, {
      model: 'gpt-test',
      system: 'test',
      user: 'test',
      reasoning: 'low',
      workdir,
      signal: controller.signal,
    }), '');
    assert.deepEqual(runtime.calls.find((call) => call.method === 'turn/interrupt').params, {
      threadId: 'thread-1',
      turnId: 'turn-1',
    });
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('any unexpected tool start is interrupted and never becomes an answer', async () => {
  const workdir = fs.mkdtempSync(path.join(outDir, 'tool-guard-'));
  const runtime = new CompletionTransport();
  runtime.request = function (method, params) {
    this.calls.push({ method, params });
    if (method === 'thread/start') return Promise.resolve({ thread: { id: 'thread-1' } });
    if (method === 'turn/start') {
      setTimeout(() => {
        for (const handler of this.handlers) {
          handler('item/started', {
            threadId: 'thread-1',
            turnId: 'turn-1',
            item: { type: 'commandExecution', command: 'cat private.txt' },
          });
        }
      }, 0);
      return Promise.resolve({ turn: { id: 'turn-1' } });
    }
    return Promise.resolve({});
  };
  try {
    await assert.rejects(() => runIsolatedCodexCompletion(runtime, {
      model: 'gpt-test',
      system: 'test',
      user: 'test',
      reasoning: 'low',
      workdir,
    }), /herramienta deshabilitada/i);
    assert.deepEqual(runtime.calls.find((call) => call.method === 'turn/interrupt').params, {
      threadId: 'thread-1',
      turnId: 'turn-1',
    });
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pixels')]);

/** Fake app-server that plays one scripted `imageGeneration` item back at the caller. */
class ImageTransport {
  handlers = new Set();
  calls = [];
  constructor(emit) {
    this.emit = emit;
  }
  request(method, params) {
    this.calls.push({ method, params });
    if (method === 'thread/start') return Promise.resolve({ thread: { id: 'thread-1' } });
    if (method === 'turn/start') {
      setTimeout(() => {
        for (const handler of this.handlers) this.emit(handler);
      }, 0);
      return Promise.resolve({ turn: { id: 'turn-1' } });
    }
    return Promise.resolve({});
  }
  onNotification(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

/** A saved image the way the runtime writes it: CODEX_HOME/generated_images/<thread>/. */
function runtimeCopy(name, bytes = PNG) {
  const dir = path.join(outDir, 'generated', name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'call-1.png');
  fs.writeFileSync(file, bytes);
  return { dir, file };
}

test('a Codex image runs on an image-only thread, ends as soon as the image exists and leaves no copy behind', async () => {
  const workdir = fs.mkdtempSync(path.join(outDir, 'image-'));
  const copy = runtimeCopy('ok');
  const runtime = new ImageTransport((handler) => handler('item/completed', {
    threadId: 'thread-1',
    turnId: 'turn-1',
    item: {
      type: 'imageGeneration',
      id: 'call-1',
      status: 'completed',
      revisedPrompt: 'un faro al atardecer, ilustración plana',
      result: PNG.toString('base64'),
      savedPath: copy.file,
    },
  }));
  try {
    const image = await runIsolatedCodexImage(runtime, {
      model: 'gpt-test',
      prompt: 'Un faro al atardecer.',
      workdir,
    });
    assert.ok(image.bytes.equals(PNG));
    assert.equal(image.mimeType, 'image/png');
    assert.equal(image.revisedPrompt, 'un faro al atardecer, ilustración plana');

    const thread = runtime.calls.find((call) => call.method === 'thread/start').params;
    assert.equal(thread.config.features.image_generation, true, 'the image tool is the point of this thread');
    assert.ok(
      Object.entries(thread.config.features)
        .filter(([name]) => name !== 'image_generation')
        .every(([, enabled]) => enabled === false),
      'nothing else the runtime can do is reachable from an image thread'
    );
    assert.equal(thread.config.web_search, 'disabled');
    assert.deepEqual(thread.config.mcp_servers, {});
    assert.equal(thread.approvalPolicy, 'never');
    assert.equal(thread.sandbox, 'read-only');
    assert.equal(thread.ephemeral, true);
    assert.equal(thread.cwd, workdir);

    const turn = runtime.calls.find((call) => call.method === 'turn/start').params;
    assert.deepEqual(turn.sandboxPolicy, { type: 'readOnly', networkAccess: false });
    assert.deepEqual(turn.input, [{ type: 'text', text: 'Un faro al atardecer.', text_elements: [] }]);

    // The turn is stopped the moment the image lands: the message the model would add
    // next costs plan quota and tens of seconds, and Nodus has no use for it.
    assert.deepEqual(runtime.calls.find((call) => call.method === 'turn/interrupt').params, {
      threadId: 'thread-1',
      turnId: 'turn-1',
    });
    assert.ok(runtime.calls.some((call) => call.method === 'thread/unsubscribe'));

    // The runtime's copy is user content sitting outside every Nodus backup, export
    // and deletion path — and ~2 MB of it per generation.
    assert.equal(fs.existsSync(copy.file), false, 'the copy under CODEX_HOME is deleted');
    assert.equal(fs.existsSync(copy.dir), false, 'and so is the emptied thread directory');
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('a Codex image falls back to the file on disk when the bytes do not travel inline', async () => {
  const workdir = fs.mkdtempSync(path.join(outDir, 'image-disk-'));
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-bytes')]);
  const copy = runtimeCopy('disk', jpeg);
  const runtime = new ImageTransport((handler) => handler('item/completed', {
    threadId: 'thread-1',
    turnId: 'turn-1',
    item: { type: 'imageGeneration', id: 'call-1', status: 'completed', revisedPrompt: null, result: '', savedPath: copy.file },
  }));
  try {
    const image = await runIsolatedCodexImage(runtime, { model: 'gpt-test', prompt: 'Una taza.', workdir });
    assert.ok(image.bytes.equals(jpeg));
    // The protocol declares no mime type at all, so it is read off the bytes.
    assert.equal(image.mimeType, 'image/jpeg');
    assert.equal(fs.existsSync(copy.file), false);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('a Codex turn that answers in words instead of generating is a failure, not an empty image', async () => {
  const workdir = fs.mkdtempSync(path.join(outDir, 'image-none-'));
  const runtime = new ImageTransport((handler) => handler('turn/completed', {
    threadId: 'thread-1',
    turn: { status: 'completed', items: [{ type: 'agentMessage', text: 'No puedo generar imágenes.' }] },
  }));
  try {
    await assert.rejects(
      () => runIsolatedCodexImage(runtime, { model: 'gpt-test', prompt: 'Un faro.', workdir }),
      /sin generar ninguna imagen/i
    );
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});

test('an unexpected tool start in an image thread is interrupted and never returns bytes', async () => {
  const workdir = fs.mkdtempSync(path.join(outDir, 'image-guard-'));
  const runtime = new ImageTransport((handler) => handler('item/started', {
    threadId: 'thread-1',
    turnId: 'turn-1',
    item: { type: 'commandExecution', command: 'cat private.txt' },
  }));
  try {
    await assert.rejects(
      () => runIsolatedCodexImage(runtime, { model: 'gpt-test', prompt: 'Un faro.', workdir }),
      /herramienta deshabilitada/i
    );
    assert.deepEqual(runtime.calls.find((call) => call.method === 'turn/interrupt').params, {
      threadId: 'thread-1',
      turnId: 'turn-1',
    });
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
});
