import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

// The integral run's @SVG Studio answer was cut at 6,000 tokens: the academic chat always
// knows its model's window, and that branch capped every answer at 6,000, skills or not.
test('an answer with invoked skills keeps its larger allowance when the window is known', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-answer-tokens-'));
  try {
    await build({ entryPoints: ['shared/researchRetrievalBudget.ts'], outfile: path.join(root, 'budget.cjs'), bundle: true, platform: 'node', format: 'cjs' });
    const { researchAnswerTokens } = require(path.join(root, 'budget.cjs'));
    assert.equal(researchAnswerTokens(null, false), 6000);
    assert.equal(researchAnswerTokens(null, true), 10_000);
    assert.equal(researchAnswerTokens(131_072, false), 6000);
    assert.equal(researchAnswerTokens(131_072, true), 10_000, 'a large window does not shrink a skill answer to 6,000');
    assert.equal(researchAnswerTokens(8192, true), Math.floor((8192 - 410) * 0.3), 'a small window still bounds it');
    assert.equal(researchAnswerTokens(512, true), 320);
    const assistant = fs.readFileSync(path.join(import.meta.dirname, '../electron/ai/researchAssistant.ts'), 'utf8');
    assert.match(assistant, /maxTokens = researchAnswerTokens\(window, skills\.length > 0\)/, 'the chat uses it');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
