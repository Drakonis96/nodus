// Live verification of the unversioned DeepSeek ids on both routes Nodus reaches them by:
// the native DeepSeek API and the OpenCode Go subscription.
//
// The unit suites pin what Nodus *builds*; this script pins what the providers *accept*.
// A profile for an id nobody serves is dead code, and a body the endpoint refuses is worse
// than no control at all, so both claims are checked against the real services.
//
// Keys come from the environment and are never read from the app's store. Every request is
// tiny (maxTokens 32) on purpose: this is a contract check, not a benchmark.
//
//   NODUS_AUDIT_DEEPSEEK_KEY=… NODUS_AUDIT_OPENCODE_GO_KEY=… \
//     node scripts/verify-deepseek-reasoning-live.mjs
//
// Either key alone is enough: the script verifies whichever route it has credentials for
// and reports the other as skipped.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-deepseek-live')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/verify-deepseek-reasoning-live.mjs'), '--electron-deepseek-live'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const deepseekKey = process.env.NODUS_AUDIT_DEEPSEEK_KEY;
const goKey = process.env.NODUS_AUDIT_OPENCODE_GO_KEY;
if (!deepseekKey && !goKey) {
  throw new Error('NODUS_AUDIT_DEEPSEEK_KEY and/or NODUS_AUDIT_OPENCODE_GO_KEY are required.');
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-deepseek-live-'));
installRuntimeHooks(userData);

const { researchReasoningProfile, researchEffortChoices, researchReasoningBody } =
  require(path.join(repoRoot, 'shared/researchReasoning.ts'));
const { completeWithOpenCodeGo } = require(path.join(repoRoot, 'electron/ai/openCodeGoCompletion.ts'));
const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
const aiClient = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));

const ref = (provider, model) => ({ provider, model });
const PROMPT = {
  system: 'You are a contract probe. Answer in one short sentence.',
  user: 'Name the capital of France.',
};

/** One tiny chat completion, returning the status, the text and whether it reasoned. */
async function probe(url, key, extraHeaders, model, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'User-Agent': 'Nodus/verify-deepseek-reasoning-live',
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      max_tokens: 64,
      messages: [{ role: 'system', content: PROMPT.system }, { role: 'user', content: PROMPT.user }],
      ...body,
    }),
  });
  const raw = await response.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch { /* keep raw */ }
  const choice = payload?.choices?.[0];
  const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning;
  return {
    status: response.status,
    error: response.ok ? null : String(payload?.error?.message ?? raw).slice(0, 200),
    text: choice?.message?.content ?? '',
    reasoningChars: typeof reasoning === 'string' ? reasoning.length : 0,
    body: payload,
  };
}

const results = [];
function report(line) {
  results.push(line);
  console.log(line);
}

async function catalogue(url, key, extraHeaders, label) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'Nodus/verify-deepseek-reasoning-live', ...extraHeaders } });
  assert.equal(response.status, 200, `${label} catalogue must answer 200`);
  const body = await response.json();
  return (body.data ?? []).map((model) => model.id).filter(Boolean);
}

try {
  // 1. Both catalogues really serve the ids the profile now handles.
  let nativeIds = [];
  let goIds = [];
  if (deepseekKey) {
    nativeIds = await catalogue('https://api.deepseek.com/models', deepseekKey, {}, 'DeepSeek native');
    report(`native catalogue: ${JSON.stringify(nativeIds)}`);
    assert.ok(nativeIds.includes('deepseek-flash'), 'the native API serves the unversioned id this patch handles');
    secrets.setApiKey('deepseek', deepseekKey);
  } else {
    report('native route: skipped (no NODUS_AUDIT_DEEPSEEK_KEY)');
  }
  if (goKey) {
    goIds = await catalogue('https://opencode.ai/zen/go/v1/models', goKey, { 'x-opencode-session': crypto.randomUUID() }, 'OpenCode Go');
    report(`go catalogue: ${JSON.stringify(goIds.filter((id) => /deepseek/i.test(id)))}`);
    assert.ok(goIds.includes('deepseek-flash'), 'the Go subscription serves the unversioned id this patch handles');
    secrets.setApiKey('opencode-go', goKey);
  } else {
    report('go route: skipped (no NODUS_AUDIT_OPENCODE_GO_KEY)');
  }

  // 2. Every DeepSeek id a catalogue serves must publish a control. This is the property
  //    the patch exists for: before it, the unversioned id fell through to `unknown()`.
  const served = [
    ...nativeIds.filter((id) => /^deepseek-(?:flash|pro|v4)/.test(id)).map((id) => ['deepseek', id]),
    ...goIds.filter((id) => /^deepseek-(?:flash|pro|v4)/.test(id)).map((id) => ['opencode-go', id]),
  ];
  assert.ok(served.length > 0, 'at least one route served a DeepSeek id to verify');
  for (const [provider, id] of served) {
    const choices = researchEffortChoices(researchReasoningProfile(ref(provider, id)));
    assert.ok(choices.length > 1, `${provider}/${id} must publish an effort control, got ${JSON.stringify(choices)}`);
  }
  report(`effort control published for: ${served.map(([p, id]) => `${p}/${id}`).join(', ')}`);

  // 3. The body Nodus now builds is accepted, and the effort actually lands: the same
  //    request with and without it must differ in reasoning output.
  const bodyCases = [
    ['deepseek', 'https://api.deepseek.com/chat/completions', deepseekKey, {}],
    ['opencode-go', 'https://opencode.ai/zen/go/v1/chat/completions', goKey, { 'x-opencode-session': crypto.randomUUID() }],
  ].filter(([, , key]) => Boolean(key));

  for (const [provider, url, key, headers] of bodyCases) {
    const model = 'deepseek-flash';
    const standard = await probe(url, key, headers, model, researchReasoningBody(ref(provider, model), 'standard', 8_000));
    assert.equal(standard.status, 200, `${provider}/${model} must accept the Standard body: ${standard.error ?? ''}`);
    assert.ok(standard.text.trim().length > 0, `${provider}/${model} must answer at Standard`);

    const top = await probe(url, key, headers, model, researchReasoningBody(ref(provider, model), 'max', 8_000));
    assert.equal(top.status, 200, `${provider}/${model} must accept the top-effort body: ${top.error ?? ''}`);
    assert.ok(top.reasoningChars > 0, `${provider}/${model} must actually reason when asked for the top effort`);
    if (provider === 'deepseek') {
      // The native route is documented as an explicit toggle, so Standard must be a real
      // "thinking off" — not merely the lowest legal level.
      assert.equal(standard.reasoningChars, 0, 'the native Standard body must disable thinking outright');
    }
    report(`${provider}/${model}: standard reasoning=${standard.reasoningChars}ch, max reasoning=${top.reasoningChars}ch, both accepted`);
  }

  // 4. A real production call: the whole path (prompt context, key lookup, scheduler,
  //    transport) must survive the new body shape on both routes. The budget is not tiny
  //    here: thinking shares the output allowance, and on the Go route Standard reasons, so
  //    a 64-token ceiling returns an empty answer — the app reserves the extra tokens with
  //    `researchThinkingAllowance`, which this probe deliberately does not reimplement.
  for (const [provider, model] of served.filter(([, id]) => id === 'deepseek-flash')) {
    const started = Date.now();
    const text = await aiClient.completeText({ ...PROMPT, researchEffort: 'high', maxTokens: 900 }, ref(provider, model));
    assert.ok(text.trim().length > 0, `completeText must return prose for ${provider}/${model}`);
    report(`completeText ${provider}/${model}: "${text.trim().slice(0, 60)}" (${Date.now() - started}ms)`);
  }

  // 5. The OpenCode Go recovery, against the real endpoint. A local proxy refuses the first
  //    request by naming `temperature` — the only way to produce the 400 this recovery
  //    exists for, since the live service accepts the field today — and forwards everything
  //    else to the real Go API, so the replayed request still has to succeed for real.
  if (goKey) {
    const seen = [];
    const proxy = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || '{}');
      seen.push(body);
      // A real deprecating provider refuses the field whenever it is present, not only on
      // the first request — otherwise "learned for the session" would be unprovable.
      if ('temperature' in body) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'temperature is deprecated for this model' } }));
        return;
      }
      const upstream = await fetch('https://opencode.ai/zen/go/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${goKey}`,
          'User-Agent': 'Nodus/verify-deepseek-reasoning-live',
          'x-opencode-session': crypto.randomUUID(),
        },
        body: raw,
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(text);
    });
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${proxy.address().port}`;
    try {
      const recovered = await completeWithOpenCodeGo({
        apiKey: goKey, model: 'deepseek-flash', system: PROMPT.system, user: PROMPT.user,
        temperature: 0.15, researchEffort: 'high', maxTokens: 64, baseUrl, sessionId: crypto.randomUUID(),
      });
      assert.ok(recovered.text.trim().length > 0, 'the replayed Go request must answer for real');
      assert.equal(seen.length, 2, 'exactly one refusal and one replay');
      assert.equal(seen[0].temperature, 0.15, 'the first attempt is optimistic');
      assert.equal('temperature' in seen[1], false, 'the replay drops the offending field');
      assert.equal(seen[1].reasoning_effort, 'high', 'the replay keeps the effort the caller asked for');

      seen.length = 0;
      const remembered = await completeWithOpenCodeGo({
        apiKey: goKey, model: 'deepseek-flash', system: PROMPT.system, user: PROMPT.user,
        temperature: 0.15, researchEffort: 'high', maxTokens: 64, baseUrl, sessionId: crypto.randomUUID(),
      });
      assert.ok(remembered.text.trim().length > 0);
      assert.equal(seen.length, 1, 'the model stays learned: the next call is not refused');
      assert.equal('temperature' in seen[0], false, 'later calls never send the knob again');
      report('go temperature recovery: refused once, replayed without the field, then remembered');
    } finally {
      await new Promise((resolve) => proxy.close(resolve));
    }
  }

  console.log('\nLive DeepSeek reasoning verification passed.');
} finally {
  fs.rmSync(userData, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-live-verify',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    // The keys live in this process only; the profile is a throwaway directory, so the
    // passthrough store is enough to make secretStore's read/write path work.
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(String(value), 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
    dialog: {}, shell: {}, BrowserWindow: class {}, ipcMain: { handle: () => undefined, on: () => undefined },
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
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
