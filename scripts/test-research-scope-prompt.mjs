import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

// Answers quoted `budget_exhausted`, `partial: true` and `readDocumentIds` to the reader,
// because the run's coverage record reached the model as it is stored.
test('the research scope a model reads names its limits in words, never as internal codes or fields', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-scope-prompt-'));
  try {
    await build({ entryPoints: ['shared/researchCorpus.ts'], outfile: path.join(root, 'corpus.cjs'), bundle: true, platform: 'node', format: 'cjs' });
    const { researchScopeForPrompt, describeResearchLimitation } = require(path.join(root, 'corpus.cjs'));
    const coverage = { scopeId: 'f'.repeat(64), sourceCount: 3, rounds: 3, evidenceTokens: 7999, decisionTokens: 4410, partial: true,
      matchedDocumentIds: ['doc-a'], readDocumentIds: ['doc-b'], limitations: ['budget_exhausted', 'no_matches', 'budget_exhausted', 'something_new'],
      sourceCoverage: [{ documentId: 'doc-a', title: 'Norias y turnos', reasons: [] }, { documentId: 'doc-b', title: 'El pleito', reasons: ['text_pending', 'embeddings_pending'] },
        { documentId: 'doc-c', title: 'Las acequias', reasons: [] }],
      queries: [{ query: 'tanda', sources: ['doc-a'], candidates: 2, partial: false }] };
    const scope = researchScopeForPrompt(coverage);
    const text = JSON.stringify(scope);
    for (const internal of ['budget_exhausted', 'no_matches', 'text_pending', 'embeddings_pending', 'something_new', 'readDocumentIds', 'matchedDocumentIds',
      'sourceCoverage', 'decisionTokens', 'scopeId', 'doc-a', 'doc-b', 'f'.repeat(64), '"partial"']) assert.ok(!text.includes(internal), `${internal} stays out of the prompt`);
    // "Not read in the original" is not a limitation: indexed passages are the source's own
    // text. Answers read original_read: false as "only summaries were seen".
    assert.deepEqual(scope.sources.map(source => [source.title, source.passages_found, source.original_read]),
      [['Norias y turnos', true, undefined], ['El pleito', false, true], ['Las acequias', false, undefined]]);
    assert.deepEqual(scope.sources[1].notes, [describeResearchLimitation('text_pending'), describeResearchLimitation('embeddings_pending')]);
    assert.equal(scope.limits.length, 3, 'each limit is described once');
    assert.match(describeResearchLimitation('no_matches'), /does not show/);
    assert.match(describeResearchLimitation('something_new'), /limit/);
    assert.equal(scope.search_may_be_incomplete, true);
    assert.equal(researchScopeForPrompt({ ...coverage, partial: false, limitations: [] }).limits, undefined);
    const assistant = fs.readFileSync(path.join(import.meta.dirname, '../electron/ai/researchAssistant.ts'), 'utf8');
    assert.match(assistant, /Passages are verbatim text of their source, not summaries/, 'the chat instruction says what a passage is');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
