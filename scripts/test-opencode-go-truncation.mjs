import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
installTsHook();
const { completeWithOpenCodeGo } = require(path.join(repoRoot, 'electron/ai/openCodeGoCompletion.ts'));

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    const anthropic = req.url?.endsWith('/v1/messages');
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(anthropic
        ? { content: [{ type: 'text', text: '{"ideas":[' }], stop_reason: 'max_tokens' }
        : { choices: [{ message: { content: '{"ideas":[' }, finish_reason: 'length' }] }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (anthropic) {
      res.write('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{\\"ideas\\":["}}\n\n');
      res.write('data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":2}}\n\n');
    } else {
      res.write('data: {"choices":[{"delta":{"content":"{\\"ideas\\":["},"finish_reason":null}]}\n\n');
      res.write('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n');
      res.write('data: [DONE]\n\n');
    }
    res.end();
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const base = { apiKey: 'test', system: 'system', user: 'user', jsonMode: true, baseUrl, timeoutMs: 5_000 };
try {
  for (const spec of [
    { model: 'gpt-test', streaming: false },
    { model: 'gpt-test', streaming: true },
    { model: 'qwen-test', streaming: false },
    { model: 'qwen-test', streaming: true },
  ]) {
    await assert.rejects(
      () => completeWithOpenCodeGo({ ...base, model: spec.model, ...(spec.streaming ? { onDelta: () => undefined } : {}) }),
      /cortó la respuesta|límite de salida/i,
      `${spec.model} ${spec.streaming ? 'stream' : 'non-stream'} rejects truncated JSON`,
    );
  }
} finally {
  server.close();
}

function installTsHook() {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(output, filename);
  };
}
