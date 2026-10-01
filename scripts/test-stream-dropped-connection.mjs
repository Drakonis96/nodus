// A streamed answer whose connection drops before any answer text (a long reasoning stream lost
// mid-read: "read ETIMEDOUT") is asked once more; once answer text has streamed, the error
// stands, so nothing shown is repeated.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--stream-dropped-connection')) process.exit(0);

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-stream-drop-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = (file) => require(path.join(repoRoot, file));
let requests = 0;
let mode = 'drop-before-answer';
const chunk = (delta) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`;
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (part) => { raw += part; });
  req.on('end', () => {
    requests += 1;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(chunk({ reasoning_content: 'Thinking about the route… ' }));
    const drop = (mode === 'drop-before-answer' && requests === 1)
      || (mode === 'drop-with-buffered-pseudonym' && requests === 1)
      || mode === 'drop-after-answer';
    if (mode === 'drop-after-answer') res.write(chunk({ content: 'Partial answer' }));
    if (mode === 'drop-with-buffered-pseudonym' && requests === 1) res.write(chunk({ content: 'STU_7K3Q' }));
    if (drop) { setTimeout(() => req.socket.destroy(), 20); return; }
    res.write(chunk({ content: mode === 'drop-with-buffered-pseudonym' ? 'STU_7K3Q has improved.' : 'Answer' }));
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  load('electron/db/settingsRepo.ts').updateSettings({ customProvider: { baseUrl: `${base}/v1`, models: ['stream-fixture'] }, chatReasoning: 'off' });
  load('electron/secrets/secretStore.ts').getApiKey = () => 'test-key';
  load('electron/ai/providers.ts').openAiCompatBase = () => `${base}/v1`;
  const ai = load('electron/ai/aiClient.ts');
  const model = { provider: 'custom', model: 'stream-fixture' };
  const opts = { system: 'system', user: 'user', maxTokens: 200, timeoutMs: 5_000 };

  // Dropped before any answer text: retried once, and the answer arrives.
  const answer = await ai.completeTextStream(opts, () => {}, model);
  assert.equal(answer, 'Answer');
  assert.equal(requests, 2, 'exactly one retry');

  // A privacy rewriter may be holding a complete pseudonym while full is still empty.
  // The failed attempt's held tail must be discarded before replay, or it is prepended
  // to the second generation and corrupts the deanonymized answer.
  requests = 0;
  mode = 'drop-with-buffered-pseudonym';
  load('electron/db/settingsRepo.ts').updateSettings({ studentPseudonymsEnabled: true });
  const { withStudentPseudonyms } = load('electron/ai/studentPrivacyContext.ts');
  const privacyAnswer = await withStudentPseudonyms({
    groupId: 'fixture-group',
    students: [{ id: 'student-1', code: 'STU_7K3Q', givenNames: 'Ana', surnames: 'Peña' }],
  }, () => ai.completeTextStream(opts, () => {}, model));
  assert.equal(privacyAnswer, 'Ana Peña has improved.');
  assert.equal(requests, 2, 'privacy-buffered drop is retried exactly once');

  // Dropped after answer text streamed: the error stands and nothing is replayed.
  requests = 0;
  mode = 'drop-after-answer';
  const shown = [];
  await assert.rejects(ai.completeTextStream(opts, (delta) => shown.push(delta), model));
  assert.equal(requests, 1, 'no retry once the answer began');
  console.log('OK: pre-answer drops retry once with clean stream state; post-answer drops are not replayed.');
} finally {
  load('electron/db/database.ts').closeDb();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(scratch, { recursive: true, force: true });
}
