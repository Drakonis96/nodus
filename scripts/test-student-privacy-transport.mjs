// Student pseudonymisation, wired through the REAL transport.
//
// scripts/test-student-pseudonyms.mjs proves the string logic. This file proves the
// plumbing: that opening a scope actually rewrites what reaches the wire, that the
// AsyncLocalStorage context survives the retry/repair paths inside completeJson, and
// that a placeholder split across streaming chunks still reaches the UI intact.
//
// It drives aiClient against a fake OpenAI-compatible server and asserts on the
// REQUEST BODIES the server received — the only assertion that actually proves a name
// did not leave the machine.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-student-privacy-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-student-privacy-transport.mjs'), '--electron-student-privacy-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-student-privacy-'));
installRuntimeHooks(root);

/** Queued replies. A string is a normal completion; {sse:[…]} streams those deltas. */
let queue = [];
let seen = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (!req.url.includes('/chat/completions')) { res.writeHead(404).end('{}'); return; }
    seen.push({ url: req.url, body: JSON.parse(body || '{}'), raw: body });
    const next = queue.shift() ?? '{}';
    if (next && typeof next === 'object' && Array.isArray(next.sse)) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const delta of next.sse) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: next }, finish_reason: 'stop' }] }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

let closeDb = () => undefined;
try {
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const aiClient = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
  const privacyCtx = require(path.join(repoRoot, 'electron/ai/studentPrivacyContext.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));

  settingsRepo.updateSettings({ localProviders: { lmstudio: { baseUrl } } });
  const model = { provider: 'lmstudio', model: 'fake-model' };
  const run = (replies) => { queue = replies; seen = []; };

  const students = [
    { id: 's1', code: 'STU_7K3Q', givenNames: 'Ana María', surnames: 'Peña López' },
    { id: 's2', code: 'STU_MMMM', givenNames: 'Juan', surnames: 'García Ruiz' },
  ];
  const roster = { groupId: 'g1', students };
  /** Everything the server ever received, as one string — the leak assertion. */
  const wire = () => JSON.stringify(seen);

  // ── The setting is on by default ───────────────────────────────────────────
  assert.equal(settingsRepo.getSettings().studentPseudonymsEnabled, true,
    'pseudonymisation is on out of the box: rosters hold the names of minors');

  // ── No scope → strict no-op ────────────────────────────────────────────────
  run(['vale']);
  assert.equal(await aiClient.completeText({ system: 's', user: 'Ana María Peña López' }, model), 'vale');
  assert.ok(wire().includes('Ana Mar'), 'outside a scope nothing is rewritten at all');

  // ── Inside a scope: names never reach the wire, codes come back mapped ─────
  run(['STU_7K3Q ha mejorado mucho.']);
  const answer = await privacyCtx.withStudentPseudonyms(roster, () =>
    aiClient.completeText({ system: 'Eres tutor.', user: '¿Cómo va Ana María Peña López?' }, model));
  assert.ok(!/Ana|Peña|López/.test(wire()), 'no real name reaches the provider');
  assert.ok(wire().includes('STU_7K3Q'), 'the placeholder does');
  assert.equal(answer, 'Ana María Peña López ha mejorado mucho.', 'the teacher sees the real name');

  // ── Ambiguity survives the transport unchanged ─────────────────────────────
  run(['ok']);
  await privacyCtx.withStudentPseudonyms(
    { groupId: 'g1', students: [...students, { id: 's3', code: 'STU_NNNN', givenNames: 'Juan', surnames: 'Sáez Coll' }] },
    () => aiClient.completeText({ system: 's', user: '¿Cómo va Juan?' }, model));
  assert.ok(wire().includes('Juan'), 'two Juanes: the model is asked the question as written');
  assert.ok(!wire().includes('STU_MMMM'), 'and neither of them is guessed at');

  // ── completeJson: deep mapping, and the repair path stays in code space ────
  const guard = (v) => !!v && typeof v === 'object' && Array.isArray(v.rows);
  run(['{"rows":[{"who":"STU_MMMM","nota":"bien"}]}']);
  const parsed = await privacyCtx.withStudentPseudonyms(roster, () =>
    aiClient.completeJson({ system: 's', user: 'Evalúa a Juan García Ruiz' }, guard, model));
  assert.deepEqual(parsed.rows, [{ who: 'Juan García Ruiz', nota: 'bien' }], 'nested JSON strings are mapped back');
  assert.ok(!/García/.test(wire()), 'the JSON prompt carried no real name either');

  // Two objects run together is the one shape jsonrepair cannot fix locally, so it is
  // what actually forces the repair round-trip. That round-trip re-sends the model's
  // own bad output through a BRAND-NEW options object built inside repairJson — the
  // exact propagation hole that made us choose AsyncLocalStorage over a CallOpts field.
  run(['{"rows":[]}{"rows":[{"who":"STU_MMMM"}]}', '{"rows":[{"who":"STU_MMMM"}]}']);
  const repaired = await privacyCtx.withStudentPseudonyms(roster, () =>
    aiClient.completeJson({ system: 's', user: 'Evalúa a Juan García Ruiz' }, guard, model));
  assert.ok(seen.some((h) => JSON.stringify(h.body).includes('invalid_json')),
    'the unparseable reply really did trigger a repair round-trip');
  assert.ok(!/García|Ana|Peña/.test(wire()), 'no retry or repair call leaks a real name');
  assert.deepEqual(repaired.rows, [{ who: 'Juan García Ruiz' }], 'and the repaired result still maps back');

  // Schema mismatch takes the retry path instead — the scope must survive that too.
  run(['{"wrong":true}', '{"rows":[{"who":"STU_MMMM"}]}']);
  await privacyCtx.withStudentPseudonyms(roster, () =>
    aiClient.completeJson({ system: 's', user: 'Evalúa a Juan García Ruiz' }, guard, model));
  assert.equal(seen.length, 2, 'schema mismatch retries the original prompt');
  assert.ok(!/García|Ana|Peña/.test(wire()), 'the retry carries no real name either');

  // ── Streaming: split the placeholder at every offset ───────────────────────
  const streamed = 'Creo que STU_7K3Q y STU_MMMM van bien.';
  const expected = 'Creo que Ana María Peña López y Juan García Ruiz van bien.';
  for (let cut = 1; cut < streamed.length; cut++) {
    run([{ sse: [streamed.slice(0, cut), streamed.slice(cut)] }]);
    const deltas = [];
    const full = await privacyCtx.withStudentPseudonyms(roster, () =>
      aiClient.completeTextStream({ system: 's', user: 'resume' },
        (d, kind) => { if ((kind ?? 'content') === 'content') deltas.push(d); }, model));
    assert.equal(full, expected, `returned answer is whole with the stream cut at ${cut}`);
    assert.equal(deltas.join(''), expected, `what the UI saw is whole with the stream cut at ${cut}`);
  }

  // One delta per character — the worst case a provider can produce.
  run([{ sse: [...streamed] }]);
  const perChar = [];
  const fullPerChar = await privacyCtx.withStudentPseudonyms(roster, () =>
    aiClient.completeTextStream({ system: 's', user: 'resume' },
      (d, kind) => { if ((kind ?? 'content') === 'content') perChar.push(d); }, model));
  assert.equal(fullPerChar, expected, 'character-by-character streaming resolves');
  assert.equal(perChar.join(''), expected, 'and the UI never saw a raw placeholder');
  assert.ok(!perChar.join('').includes('STU_'), 'no placeholder survived to the renderer');

  // A stream ending ON a placeholder only works because finish() flushes. Without it
  // the last characters vanish, and `return full` would evaluate before any `finally`.
  run([{ sse: ['Va bien ', 'STU_', '7K3Q'] }]);
  const trailing = await privacyCtx.withStudentPseudonyms(roster, () =>
    aiClient.completeTextStream({ system: 's', user: 'resume' }, () => {}, model));
  assert.equal(trailing, 'Va bien Ana María Peña López', 'a trailing placeholder is flushed, not dropped');

  // The name substitution is robust to the shapes that look like they would defeat the
  // full-name token: odd spacing, a line break in the middle. In each case the layer
  // still removes the name — via the surname pair or the individual tokens — so the
  // residual check has nothing left to catch.
  //
  // That is worth stating plainly: with a correctly built scope, `findResidualNames`
  // cannot fire. It is a backstop against a BUG in the matcher (the likely failure
  // being a silent no-op, which is indistinguishable from success without it), not a
  // guard against unusual input. Its logic is exercised directly in
  // scripts/test-student-pseudonyms.mjs; what the transport adds is the `throw`, and
  // the images case below is what proves the transport really refuses to send.
  for (const tricky of ['Ana María  Peña López', 'Ana María\nPeña López', 'PEÑA LÓPEZ, Ana María']) {
    run(['ok']);
    await privacyCtx.withStudentPseudonyms(roster, () =>
      aiClient.completeText({ system: 's', user: tricky }, model));
    // Word-bounded: a longer word that merely CONTAINS these letters is not a name
    // mention, and the layer is right not to rewrite inside one.
    assert.ok(!/\b(Ana|María|Peña|López)\b/i.test(wire()), `no name escapes via: ${JSON.stringify(tricky)}`);
  }

  // ── Fails closed on the way out ────────────────────────────────────────────

  run(['no debería llegar']);
  await assert.rejects(
    () => privacyCtx.withStudentPseudonyms(roster, () =>
      aiClient.completeText({ system: 's', user: 'mira esto', images: [{ base64: 'x', mediaType: 'image/png' }] }, model)),
    /imágenes/i,
    'a name written on a scanned exam cannot be substituted, so the send is refused',
  );
  assert.equal(seen.length, 0, 'and nothing reached the provider');

  // ── The toggle really disables it ──────────────────────────────────────────
  settingsRepo.updateSettings({ studentPseudonymsEnabled: false });
  run(['vale']);
  await privacyCtx.withStudentPseudonyms(roster, () =>
    aiClient.completeText({ system: 's', user: '¿Cómo va Ana María Peña López?' }, model));
  assert.ok(wire().includes('Ana Mar'), 'off means off — no scope is entered at all');
  settingsRepo.updateSettings({ studentPseudonymsEnabled: true });

  console.log('student privacy transport: OK');
} finally {
  closeDb();
  server.close();
  await rm(root, { recursive: true, force: true });
}

/**
 * Maps `@shared/*` to the TS sources, stubs Electron, and registers a `.ts` loader so
 * the test can require the real main-process modules with no build step.
 */
function installRuntimeHooks(userData) {
  const Module = require('node:module');
  const ts = require('typescript');

  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...args) {
    if (request.startsWith('@shared/')) {
      return originalResolve.call(this, path.join(repoRoot, 'shared', `${request.slice('@shared/'.length)}.ts`), ...args);
    }
    return originalResolve.call(this, request, ...args);
  };

  const electronStub = {
    app: {
      getPath: () => userData,
      getName: () => 'Nodus',
      getVersion: () => '0.0.0-test',
      on: () => undefined,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s) => Buffer.from(s, 'utf8'),
      decryptString: (b) => Buffer.from(b).toString('utf8'),
    },
    dialog: { showMessageBoxSync: () => 0 },
    BrowserWindow: { getAllWindows: () => [] },
    ipcMain: { handle: () => undefined, on: () => undefined },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...args) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, ...args);
  };

  require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
      fileName: filename,
    });
    module._compile(outputText, filename);
  };
}
