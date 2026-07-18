// Live verification of student pseudonymisation against a REAL model.
//
// The unit and transport tests use a fake provider, which proves the plumbing but not
// the thing that actually decides whether this feature works: that a real LLM carries
// an opaque `STU_7K3Q` through its answer instead of rewriting, translating or
// "helpfully" expanding it. That is a property of the model, not of our code, so it
// can only be checked against real ones.
//
// The payload is inspected two ways, because each covers the other's blind spot:
//
//  1. A recording proxy in front of a LOCAL provider reads the literal bytes — the
//     only thing that truly proves a name did not leave. It cannot cover Gemini:
//     providers.ts hardcodes that base URL, so settings cannot redirect it. (Patching
//     globalThis.fetch does not work either; the OpenAI SDK does not route through it,
//     and an empty recording would make every "no name was sent" assertion pass
//     vacuously — which is precisely the failure this file exists to rule out.)
//
//  2. The MODEL as leak detector — ask it to report every person name it can see.
//     Works against any provider, and asks the better question: what the model
//     actually perceived, rather than what we believe we serialised.
//
// Every check is paired with a toggle-off control, so a silently broken harness fails
// loudly instead of passing green.
//
//   Local:  VERIFY_PROVIDER=ollama VERIFY_MODEL=qwen2.5:7b node scripts/verify-student-pseudonyms.mjs
//   Cloud:  VERIFY_PROVIDER=gemini VERIFY_MODEL=gemini-2.5-flash-lite \
//           GEMINI_API_KEY=... node scripts/verify-student-pseudonyms.mjs
//
// The key is injected into an ephemeral vault's secret store and then deleted from the
// environment, so it cannot leak into a child process or an SDK that scavenges env.

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

if (!process.argv.includes('--electron-verify-pseudonyms')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/verify-student-pseudonyms.mjs'), '--electron-verify-pseudonyms'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const provider = process.env.VERIFY_PROVIDER || 'ollama';
const modelId = process.env.VERIFY_MODEL || 'qwen2.5:7b';
const localUpstream = process.env.VERIFY_LOCAL_BASE || 'http://localhost:11434';
const apiKey = process.env.GEMINI_API_KEY || process.env.VERIFY_API_KEY || '';

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-verify-pseudonyms-'));
installRuntimeHooks(root);

const realFetch = globalThis.fetch;
const wire = [];
const wireText = () => wire.join('\n');

function startRecordingProxy(upstream) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      if (body) wire.push(body);
      try {
        const upstreamRes = await realFetch(`${upstream}${req.url}`, {
          method: req.method,
          headers: { 'content-type': 'application/json' },
          body: body || undefined,
        });
        const text = await upstreamRes.text();
        res.writeHead(upstreamRes.status, {
          'content-type': upstreamRes.headers.get('content-type') ?? 'application/json',
        });
        res.end(text);
      } catch (cause) {
        res.writeHead(502).end(JSON.stringify({ error: { message: String(cause) } }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

let closeDb = () => undefined;
let failed = false;
try {
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const aiClient = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
  const privacyCtx = require(path.join(repoRoot, 'electron/ai/studentPrivacyContext.ts'));
  const { buildPseudonymScope, anonymizeText } = require(path.join(repoRoot, 'shared/studentPseudonyms.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));

  if (provider === 'gemini') {
    assert.ok(apiKey, 'GEMINI_API_KEY is required for the cloud run');
    secrets.setApiKey('gemini', apiKey);
    delete process.env.GEMINI_API_KEY;
    delete process.env.VERIFY_API_KEY;
  } else {
    settingsRepo.updateSettings({ studyAiPrivacyMode: 'local', studyAiLocalOnly: true });
  }
  settingsRepo.updateSettings({ studentPseudonymsEnabled: true });

  const model = { provider, model: modelId };
  const students = [
    { id: 's1', code: 'STU_7K3Q', givenNames: 'Ana María', surnames: 'Peña López' },
    { id: 's2', code: 'STU_MMMM', givenNames: 'Juan', surnames: 'García Ruiz' },
  ];
  const roster = { groupId: 'g1', students };
  const NAMES = /\b(Ana|Mar[íi]a|Pe[ñn]a|L[óo]pez|Juan|Garc[íi]a|Ruiz)\b/i;
  const NOTES = 'Notas de la última prueba: Ana María Peña López sacó un 9, Juan García Ruiz sacó un 4.';
  const on = (value) => settingsRepo.updateSettings({ studentPseudonymsEnabled: value });

  console.log(`\n── ${provider} / ${modelId} ─────────────────────────────────────\n`);

  /* 1. What literally goes over the wire (local providers only) --------------- */
  if (provider !== 'gemini') {
    // The app appends /v1 to the configured base itself, and req.url already carries
    // it — so the proxy forwards to the bare upstream, not to upstream + /v1.
    const proxy = await startRecordingProxy(localUpstream);
    settingsRepo.updateSettings({ localProviders: { ollama: { baseUrl: proxy.url } } });

    wire.length = 0;
    await privacyCtx.withStudentPseudonyms(roster, () =>
      aiClient.completeText({ system: 'Responde en una frase.', user: NOTES }, model));
    assert.ok(wire.length, 'the proxy recorded a request — an empty recording proves nothing');
    assert.ok(!NAMES.test(wireText()), 'no real student name left the machine');
    assert.ok(/STU_7K3Q/.test(wireText()) && /STU_MMMM/.test(wireText()), 'the placeholders did');
    console.log('  ✓ wire payload carries codes, not names');

    on(false);
    wire.length = 0;
    await privacyCtx.withStudentPseudonyms(roster, () =>
      aiClient.completeText({ system: 'Responde en una frase.', user: NOTES }, model));
    assert.ok(NAMES.test(wireText()), 'control: with the toggle off the names really are sent');
    on(true);
    console.log('  ✓ control passed — the wire assertion is not vacuous');

    // Direct from here: the proxy buffers the response, which would flatten SSE.
    proxy.server.close();
    settingsRepo.updateSettings({ localProviders: { ollama: { baseUrl: localUpstream } } });
  }

  /* 2. The model itself as leak detector -------------------------------------- */
  //
  // Deliberately run OUTSIDE a privacy scope, with the prompt anonymised by hand.
  //
  // Running it inside a scope reads as the obvious thing to do and is useless: the
  // model dutifully answers "STU_7K3Q, STU_MMMM", our reverse mapping turns that back
  // into "Ana María Peña López, Juan García Ruiz", and the assertion sees real names
  // and fails — not because anything leaked, but because the layer worked. The round
  // trip masks exactly what this check is trying to observe, so the detector has to
  // look at the model's RAW output.
  const detectorSystem =
    'Eres un detector de datos personales. Responde SOLO con los nombres propios de persona que veas, ' +
    'separados por comas. Si no hay ninguno, responde exactamente: NINGUNO';

  const scope = buildPseudonymScope(students);
  const anonymisedNotes = anonymizeText(NOTES, scope).text;
  assert.ok(!NAMES.test(anonymisedNotes), 'sanity: our own anonymisation removed the names first');

  const hidden = await aiClient.completeText({ system: detectorSystem, user: anonymisedNotes }, model);
  console.log('  detector :', hidden.replace(/\s+/g, ' ').slice(0, 160));
  assert.ok(!NAMES.test(hidden), `the model could still see a real name: ${hidden}`);
  console.log('  ✓ the model reports no student names');

  const exposed = await aiClient.completeText({ system: detectorSystem, user: NOTES }, model);
  console.log('  control  :', exposed.replace(/\s+/g, ' ').slice(0, 160));
  assert.ok(NAMES.test(exposed), 'control: given the raw text, the same detector does see the names');
  console.log('  ✓ control passed — the detector can see names when they are sent');

  /* 3. Round trip: codes out, real names back in ------------------------------ */
  const answer = await privacyCtx.withStudentPseudonyms(roster, () =>
    aiClient.completeText({
      system: 'Eres un tutor. Responde en una sola frase breve y menciona al alumno por su identificador exacto.',
      user: `${NOTES} ¿Quién necesita refuerzo?`,
    }, model));
  console.log('  answer   :', answer.replace(/\s+/g, ' ').slice(0, 180));
  assert.ok(
    /Juan García Ruiz/.test(answer) || /Ana María Peña López/.test(answer),
    `the model returned no usable identifier; raw answer: ${answer}`,
  );
  assert.ok(!/STU_/i.test(answer), 'no raw placeholder is left in what the teacher reads');
  console.log('  ✓ answer mapped back to real names, no placeholder visible');

  /* 4. Streaming end to end --------------------------------------------------- */
  const deltas = [];
  const streamed = await privacyCtx.withStudentPseudonyms(roster, () =>
    aiClient.completeTextStream({
      system: 'Eres un tutor. Responde en una sola frase y nombra al alumno por su identificador exacto.',
      user: `${NOTES} ¿Quién necesita refuerzo?`,
    }, (delta, kind) => { if ((kind ?? 'content') === 'content') deltas.push(delta); }, model));
  console.log('  stream   :', streamed.replace(/\s+/g, ' ').slice(0, 180));
  assert.equal(deltas.join(''), streamed, 'what the UI saw equals the saved answer');
  assert.ok(!/STU_/i.test(deltas.join('')), 'no raw placeholder ever reached the renderer');
  assert.ok(
    /Juan García Ruiz/.test(streamed) || /Ana María Peña López/.test(streamed),
    `streamed answer carried no usable identifier: ${streamed}`,
  );
  console.log(`  ✓ streaming clean across ${deltas.length} deltas`);

  console.log(`\n  ALL CHECKS PASSED for ${provider}/${modelId}\n`);
} catch (cause) {
  failed = true;
  console.error(`\n  FAILED for ${provider}/${modelId}: ${cause?.message ?? cause}\n`);
} finally {
  closeDb();
  await rm(root, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);

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
    app: { getPath: () => userData, getName: () => 'Nodus', getVersion: () => '0.0.0-verify', on: () => undefined },
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
